from datetime import date

def exercise(id,name,rep,progress,video=''):
    return dict(id=id,name=name,reps=rep,sets=progress,video=video)

ROUTINES = {
'A': [
exercise('a1','Lat machine','8–10',[3,3,3,3,4,4,4,4],'https://www.youtube.com/shorts/yjAwJcVDZoY'),
exercise('a2','Face pull al cavo','8–10',[2,2,3,3,3,3,4,4],'https://youtu.be/0Po47vvj9g4'),
exercise('a3','Military press in piedi (manubri)','10–12',[2,2,2,3,3,3,3,3],'https://youtube.com/shorts/ZDcXYcZB0ik'),
exercise('a4','Leg curl sdraiato','8–10',[3,3,3,3,4,4,4,4],'https://youtube.com/shorts/lGNeJsdqJwg'),
exercise('a5','Hyperextension con disco','8–10',[2,2,3,3,3,3,4,4],'https://youtube.com/shorts/SOhkqFNtePg'),
exercise('a6','Pushdown corda','8–10',[3,3,3,3,4,4,4,4],'https://youtube.com/shorts/NvZKjiZ8NYc'),
exercise('a7','French press cavo basso','8–10',[2,2,3,3,3,3,4,4],'https://youtube.com/shorts/6epaciFny0A')],
'B': [
exercise('b1','Chest press','8–10',[3,3,3,3,4,4,4,4],'https://youtube.com/shorts/Qu7-ceCvq7w'),
exercise('b2','Croci ai cavi','8–10',[2,2,3,3,3,3,4,4],'https://youtube.com/shorts/scFDrx8W22M'),
exercise('b3','Shoulder press machine','10–12',[2,2,2,3,3,3,3,3],'https://youtube.com/shorts/6v4nrRVySj0'),
exercise('b4','Leg extension','8–10',[3,3,3,3,4,4,4,4],'https://youtube.com/shorts/uM86QE59Tg'),
exercise('b5','Mezzo affondo con manubri','8–10',[2,2,3,3,3,3,4,4],'https://youtube.com/shorts/XDfEXW1PMAM'),
exercise('b6','Curl manubri su panca','8–10',[3,3,3,4,4,4,4,4],'https://youtube.com/shorts/AY6ag7V4SyY'),
exercise('b7','Bayesian curl ai cavi bassi','8–10',[2,2,3,3,3,3,4,4],'https://youtube.com/shorts/_Z8Afknw_Fc')],
'C': [
exercise('c1','Spinte manubri','8–10',[3,3,3,4,4,4,4,4],'https://youtube.com/shorts/ctRERPaSzjM'),
exercise('c2','Pulley sbarra lunga','8–10',[3,3,3,3,4,4,4,4],'https://youtube.com/shorts/PrmbBJGmxJw'),
exercise('c3','Leg press 45 gradi','8–10',[4,4,4,4,4,5,5,5],'https://youtube.com/shorts/EotSw18oR9w'),
exercise('c4','Curl corda bassa','8–10',[3,3,3,3,3,3,4,4],'https://youtube.com/shorts/I8wPlwuTWjQ'),
exercise('c5','Calf su rialzo con manubri','10–12',[5,5,5,5,5,6,6,6],'https://youtube.com/shorts/1H7dFHT3kIU')]
}

def initial_state():
    return {
        'profile':{'name':'','age':28,'height':166,'startingWeight':90,'budget':50,'week':1,'startDate':date.today().isoformat(),'gymDays':['Lunedì','Mercoledì','Venerdì'],'notes':'Lavoro lun–gio 9–18, ven 9–17. Palestra 19:30–22:00, rientro 22:15–22:30. Pranzo al lavoro alle 13: primo + contorno; secondo sottovuoto per cena. Niente colazione obbligatoria.'},
        'routines':ROUTINES,
        'workouts':[],
        'weights':[],
        'meals':{
            'Lunedì':{'lunch':'Primo + contorno dal lavoro','pre':'Banana','dinner':'Secondo del lavoro + accompagnamento'},
            'Martedì':{'lunch':'Primo + contorno dal lavoro','pre':'Yogurt o frutta (facoltativo)','dinner':'Secondo del lavoro + verdure'},
            'Mercoledì':{'lunch':'Primo + contorno dal lavoro','pre':'Banana o gallette','dinner':'Secondo del lavoro + accompagnamento'},
            'Giovedì':{'lunch':'Primo + contorno dal lavoro','pre':'Frutta o yogurt (facoltativo)','dinner':'Secondo del lavoro + contorno'},
            'Venerdì':{'lunch':'Primo + contorno dal lavoro','pre':'Banana','dinner':'Secondo del lavoro + accompagnamento'},
            'Sabato':{'lunch':'Pasta + ceci o tonno + verdure','pre':'Frutta (facoltativo)','dinner':'Pollo + patate + verdure'},
            'Domenica':{'lunch':'Riso + legumi + verdure','pre':'Yogurt (facoltativo)','dinner':'Frittata + pane + verdure'}
        },
        'groceries':[
            {'id':'g1','name':'Banane','qty':'1 kg','price':2.50,'checked':False,'category':'Spuntini'},
            {'id':'g2','name':'Yogurt greco','qty':'2 × 500 g','price':4.50,'checked':False,'category':'Spuntini'},
            {'id':'g3','name':'Uova','qty':'6','price':2.50,'checked':False,'category':'Proteine'},
            {'id':'g4','name':'Tonno al naturale','qty':'2 scatolette','price':3.00,'checked':False,'category':'Proteine'},
            {'id':'g5','name':'Pollo','qty':'400–500 g','price':5.50,'checked':False,'category':'Proteine'},
            {'id':'g6','name':'Pasta','qty':'500 g','price':1.20,'checked':False,'category':'Dispensa'},
            {'id':'g7','name':'Riso','qty':'500 g','price':1.90,'checked':False,'category':'Dispensa'},
            {'id':'g8','name':'Patate','qty':'1 kg','price':2.00,'checked':False,'category':'Dispensa'},
            {'id':'g9','name':'Pane integrale','qty':'1 confezione','price':2.20,'checked':False,'category':'Dispensa'},
            {'id':'g10','name':'Gallette','qty':'1 confezione','price':1.60,'checked':False,'category':'Dispensa'},
            {'id':'g11','name':'Legumi','qty':'2 confezioni','price':2.00,'checked':False,'category':'Dispensa'},
            {'id':'g12','name':'Verdure surgelate','qty':'1 kg','price':3.00,'checked':False,'category':'Verdure e frutta'},
            {'id':'g13','name':'Verdure fresche','qty':'1 kg','price':3.50,'checked':False,'category':'Verdure e frutta'},
            {'id':'g14','name':'Frutta extra','qty':'1 kg','price':3.00,'checked':False,'category':'Verdure e frutta'},
            {'id':'g15','name':'Passata di pomodoro','qty':'1 bottiglia','price':1.20,'checked':False,'category':'Dispensa'}
        ],
        'inventory':[],
        'habits':{},
        'notes':[],
        'appVersion':1
    }
