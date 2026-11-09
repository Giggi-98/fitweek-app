# Builder per l'APK Android di FitWeek: Node 20 + JDK 17 + Android SDK 34. Nessuna installazione sull'host.
FROM node:20.18.1-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends openjdk-17-jdk-headless unzip imagemagick \
    && rm -rf /var/lib/apt/lists/*
ENV ANDROID_SDK_ROOT=/opt/android-sdk ANDROID_HOME=/opt/android-sdk
RUN mkdir -p $ANDROID_SDK_ROOT/cmdline-tools \
    && curl -fsSL -o /tmp/tools.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip \
    && unzip -q /tmp/tools.zip -d $ANDROID_SDK_ROOT/cmdline-tools && mv $ANDROID_SDK_ROOT/cmdline-tools/cmdline-tools $ANDROID_SDK_ROOT/cmdline-tools/latest \
    && rm /tmp/tools.zip
ENV PATH=$PATH:$ANDROID_SDK_ROOT/cmdline-tools/latest/bin:$ANDROID_SDK_ROOT/platform-tools:$ANDROID_SDK_ROOT/build-tools/34.0.0
RUN yes | sdkmanager --licenses >/dev/null && sdkmanager --install "platform-tools" "platforms;android-34" "build-tools;34.0.0" >/dev/null
WORKDIR /work
