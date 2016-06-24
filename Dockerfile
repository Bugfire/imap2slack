FROM node:5

RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app

COPY package.json /usr/src/app/
RUN npm install

COPY *.js run.sh /usr/src/app/

VOLUME ["/data"]

CMD [ "./run.sh" ]
