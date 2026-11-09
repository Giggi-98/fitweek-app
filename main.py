import os, json, sqlite3, secrets, hmac, threading
from pathlib import Path
from contextlib import contextmanager
from fastapi import FastAPI, Request, HTTPException, Response
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from seed import initial_state

BASE = Path(__file__).resolve().parent
DB = Path(os.environ.get('DB_PATH','/data/fitweek.sqlite'))
PASSWORD = os.environ.get('APP_PASSWORD','')
SECRET = os.environ.get('SESSION_SECRET','')
if not PASSWORD or len(PASSWORD) < 10:
    raise RuntimeError('Imposta APP_PASSWORD (almeno 10 caratteri) nel file .env')
if not SECRET or len(SECRET) < 32:
    raise RuntimeError('Imposta SESSION_SECRET (almeno 32 caratteri) nel file .env')
DB.parent.mkdir(parents=True, exist_ok=True)
serializer = URLSafeTimedSerializer(SECRET, salt='fitweek-session')
lock = threading.Lock()
app = FastAPI(title='FitWeek', docs_url=None, redoc_url=None, openapi_url=None)

@contextmanager
def conn():
    c=sqlite3.connect(str(DB),timeout=15)
    try: yield c
    finally: c.close()

with conn() as c:
    c.execute('PRAGMA journal_mode=WAL')
    c.execute('CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, json TEXT NOT NULL)')
    if not c.execute('SELECT id FROM app_state WHERE id=1').fetchone():
        c.execute('INSERT INTO app_state VALUES (1,1,?)',(json.dumps(initial_state(),ensure_ascii=False),))
    c.commit()

def authenticated(req):
    token = req.cookies.get('fitweek_session','')
    if not token: return False
    try: return serializer.loads(token, max_age=60*60*24*30) == 'authorized'
    except (BadSignature,SignatureExpired): return False

def need_auth(req):
    if not authenticated(req): raise HTTPException(status_code=401,detail='Accesso richiesto')

def check_origin(req):
    origin=req.headers.get('origin')
    if origin:
        from urllib.parse import urlparse
        o=urlparse(origin)
        host=req.headers.get('host','')
        if o.netloc != host or o.scheme not in ('http','https'):
            raise HTTPException(status_code=403,detail='Origin non autorizzata')

@app.post('/api/login')
async def login(req:Request):
    check_origin(req)
    body=await req.json()
    if not hmac.compare_digest(str(body.get('password','')), PASSWORD):
        raise HTTPException(status_code=401,detail='Password errata')
    response=JSONResponse({'ok':True})
    secure=os.getenv('COOKIE_SECURE','false').lower()=='true'
    response.set_cookie('fitweek_session',serializer.dumps('authorized'),httponly=True,samesite='lax',secure=secure,max_age=2592000,path='/')
    return response

@app.post('/api/logout')
async def logout(req:Request):
    check_origin(req)
    response=JSONResponse({'ok':True})
    response.delete_cookie('fitweek_session',path='/')
    return response

@app.get('/api/state')
async def get_state(req:Request):
    need_auth(req)
    with conn() as c:
        version,blob=c.execute('SELECT version,json FROM app_state WHERE id=1').fetchone()
    return {'version':version,'data':json.loads(blob)}

@app.put('/api/state')
async def put_state(req:Request):
    need_auth(req); check_origin(req)
    body=await req.json()
    state=body.get('data')
    expected=body.get('version')
    if not isinstance(state,dict) or not isinstance(expected,int):
        raise HTTPException(status_code=400,detail='Formato stato non valido')
    if not all(k in state for k in ('profile','routines','workouts','weights','meals','groceries','inventory')):
        raise HTTPException(status_code=400,detail='Dati incompleti')
    blob=json.dumps(state,ensure_ascii=False)
    if len(blob)>2_000_000: raise HTTPException(status_code=413,detail='Dati troppo grandi')
    with lock:
        with conn() as c:
            current=c.execute('SELECT version FROM app_state WHERE id=1').fetchone()[0]
            if expected!=current:
                raise HTTPException(status_code=409,detail='Dati modificati da un altro dispositivo. Ricarica prima di salvare.')
            c.execute('UPDATE app_state SET version=?,json=? WHERE id=1',(current+1,blob)); c.commit()
    return {'ok':True,'version':current+1}

@app.get('/api/backup')
async def backup(req:Request):
    need_auth(req)
    with conn() as c:
        version,blob=c.execute('SELECT version,json FROM app_state WHERE id=1').fetchone()
    return JSONResponse({'format':'fitweek-backup-v1','version':version,'data':json.loads(blob)},headers={'Content-Disposition':'attachment; filename="fitweek-backup.json"','Cache-Control':'no-store'})

@app.get('/api/original-pdf')
async def original_pdf(req:Request):
    need_auth(req)
    return FileResponse(BASE/'resources'/'scheda-originale.pdf', media_type='application/pdf',filename='scheda-originale.pdf')

@app.get('/api/health')
async def health(): return {'ok':True}

@app.get('/')
async def index(): return FileResponse(BASE/'static'/'index.html')
app.mount('/static',StaticFiles(directory=BASE/'static'),name='static')
