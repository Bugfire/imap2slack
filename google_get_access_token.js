#!/usr/bin/env node

'use strict';

const google = require('googleapis');
const readline = require('readline');
const config = require('/data/config.js');

const REDIRECT_URL = 'urn:ietf:wg:oauth:2.0:oob';
const SCOPE = ['https://www.googleapis.com/auth/drive'];

const rl =
    readline.createInterface({input: process.stdin, output: process.stdout});

let r = {};

const getCode = () => {
    return new Promise((resolve, reject) => {
        r.oauth2Client = new google.auth.OAuth2(
            config.gdrive.auth.client_id, config.gdrive.auth.client_secret,
            REDIRECT_URL);
        const url = r.oauth2Client.generateAuthUrl(
            {access_type: 'offline', scope: SCOPE});

        console.log('Open this url in web-browser : ', url);
        rl.question('Input displayed code >>> ', code => {
            r.code = code;
            return resolve();
        });
    });
};

const getAccessToken = () => {
    return new Promise((resolve, reject) => {
        r.oauth2Client.getToken(r.code, (err, tokens) => {
            if (err) {
                return reject(err);
            }
            return resolve(tokens);
        });
    });
};

getCode()
    .then(getAccessToken)
    .then(tokens => {
        console.log('Refresh token is:');
        console.log(tokens.refresh_token);
        console.log('...done');
        process.exit(0);
    })
    .catch(err => {
        console.log(err);
        process.exit(1);
    });
