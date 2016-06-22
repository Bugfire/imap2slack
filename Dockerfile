FROM node:4

RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app

COPY package.json /usr/src/app/
RUN npm install

COPY imap2slack.js run.sh /usr/src/app/

VOLUME ["/data"]

CMD [ "./run.sh" ]
