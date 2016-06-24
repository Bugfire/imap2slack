#!/usr/bin/env node

'use strict';

const log =
    msg => {
        console.log((new Date()).toString() + ': ' + msg);
    }

// -- MAIL

const Promise = require('bluebird');
Promise.longStackTraces();

const Inbox = require('inbox');
const MailParser = require('mailparser').MailParser;
const fs = require('fs');
const request = require('request');
const google = require('googleapis');
const config = require('/data/config.js');

let m = {
    retry: 0,        // 連続retryカウンタ
    t_retry: 0,      // 1時間以内retryカウンタ
    cnt_connect: 0,  // コネクト回数
};

const imap_connect = () => {
    const imap = Inbox.createConnection(
        false, 'imap.gmail.com', {secureConnection: true, auth: config.mail.auth});

    imap.on('connect', () => {
        log('imap: connected');
        m.cnt_connect++;
        m.retry = 0;
        (t => {
            setTimeout(() => {
                // 1時間次のコネクトしなければm.t_retryをリセット
                if (t == m.cnt_connect) {
                    log('imap: connect counter resetted');
                    m.t_retry = 0;
                }
            }, 3600 * 1000);
        })(m.cnt_connect);
        imap.openMailbox('INBOX', {readOnly: false}, function(error) {
            if (error) {
                log('imap: openMailbox error: ' + error);
                imap.close();
                return;
            }
            imap.search({unseen: true}, true, function(error, result) {
                log('imap: unseen: ' + JSON.stringify(result));
                if (error) {
                    log('imap: openMailbox error: ' + error);
                    imap.close();
                    return;
                }
                const check_unseen = function(list) {
                    if (list.length == 0) {
                        return;
                    }
                    const t = list.shift();
                    fetch_mail(t, function(error) { check_unseen(list); });
                };
                check_unseen(result);
            });
        });
    });

    imap.on('close', () => {
        log('imap: disconnected');
        let wait;
        if (m.retry == 0 && m.t_retry < 10) {
            wait = 100;
        } else if (m.retry < 10 && m.t_retry < 20) {
            wait = 5 * 1000;
        } else {
            wait = 120 * 1000;
        }
        setTimeout(() => {
            log('imap: try reconnect');
            m.retry++;
            m.t_retry++;
            imap_connect();
        }, wait);
    });

    imap.on('error', message => { log('imap: error\n' + message); });

    const fetch_mail =
        (uid, callback) => {
            log('imap: fetching... [' + uid + ']');
            const stream = imap.createMessageStream(uid);
            const mailParser = new MailParser();
            mailParser.on('end', mail => {
                mail.uid = uid;
                if (typeof mail.attachments !== 'undefined' && mail.attachments.length > 0) {
                    const a = mail.attachments[0];
                    check_mail(mail, (new Date().toISOString()) + '-' + a.fileName, a.content, callback);
                } else {
                    check_mail(mail, null, null, callback);
                }
            });
            stream.on('error', () => {
                log('imap: stream error: ' + uid);
                callback({message: 'stream error'});
            });
            stream.pipe(mailParser)
        }

    const check_mail = (mail, filename, content, callback) => {
        log('imap: check_mail: message\n' +
            'name: ' + mail.from[0].name + ' ' + mail.from[0].address + '\n' +
            'subject: ' + mail.subject);
        if (false && config.debug)
            log('body: ' + mail.text);

        config.mail_filter(mail.from[0].address, mail.subject, mail.text, (subject, body) => {
            if (typeof subject !== 'undefined' && typeof body !== 'undefined') {
                let p;
                if (filename && content) {
                    p = send_slack_image(subject, body, filename, content);
                } else {
                    p = send_slack(subject, body);
                }
                p.then(() => {
                   imap.addFlags(mail.uid, ['\\Seen'], (err, flags) => { callback(err); });
                }).catch((err) => { err = err || (new Error('unknown error')); callback(err); });
            } else {
                log('imap: IGNORED: ' + mail.uid);  // + JSON.stringify(mail));
                callback(null);
            }
        });
    };

    imap.on('new', message => {
        log('imap: new:');
        fetch_mail(message.UID, error => {});
    });

    imap.on('error', message => { log('imap: error: ' + message); });

    log('imap: connect');
    imap.connect();

    //XXX
    setTimeout(() => { fetch_mail(622, () => {}); }, 10*1000);
};

// -- Google drive

const REDIRECT_URL = 'urn:inetf:wg:oauth:2.0:oob';

let _oauth2Client = null;

const getMimeTypeFromFilename = filename => {
    if (filename.substr(-4).toLowerCase() == '.jpg' ||
        filename.substr(-5).toLowerCase() == '.jpeg') {
        return 'image/jpeg';
    }
    if (filename.substr(-4).toLowerCase() == '.png') {
        return 'image/png';
    }
    return 'application/octet-stream';
};

const getOauth2Client = () => {
    if (_oauth2Client == null) {
        _oauth2Client = new google.auth.OAuth2(
            config.gdrive.auth.client_id, config.gdrive.auth.client_secret, REDIRECT_URL);
        _oauth2Client.setCredentials({
            refresh_token: config.gdrive.auth.refresh_token,
        });
    }
    return _oauth2Client;
};

const get_gdrive_dir = dirname => {
    return new Promise((resolve, reject) => {
        const drive = google.drive({version: 'v2', auth: getOauth2Client()});
        console.log('checking gdrive, dirname ' + dirname);
        drive.files.list(
            {
              q: "title='" + dirname + "'",
            },
            (err, res) => {
                if (err || Array.isArray(res.items) == false || res.items.length != 1) {
                    console.log('error ' + JSON.stringify({res: res, err: err}));
                    return reject(err);
                }
                return resolve(res.items[0].id);
            });
    });
};

const upload_gdrive = (folderID, filename, content) => {
    return new Promise((resolve, reject) => {
        const drive = google.drive({version: 'v2', auth: getOauth2Client()});
        const mimeType = getMimeTypeFromFilename(filename);
        drive.files.insert(
            {
              auth: getOauth2Client(),
              resource: {
                  title: filename,
                  mimeType: mimeType,
                  parents: [
                      {
                        id: folderID,
                      },
                  ],
              },
              media: {mimeType: mimeType, body: content},
            },
            (err, res) => {
                if (err) {
                    return reject(err);
                }
                return resolve('https://docs.google.com/a/cid.jp/uc?id=' + res.id);
            });
    });
};

const send_gdrive = (filename, content) => {
    return new Promise((resolve, reject) => {
        get_gdrive_dir(config.gdrive.dir)
            .then(folderID => upload_gdrive(folderID, filename, content))
            .then(uri => resolve(uri))
            .catch(reject);
    });
};

// -- Slack

const slack_api_uri = 'https://slack.com/api/';

const send_slack_image = (title, message, filename, content) => {
    return new Promise((resolve, reject) => {
        if (config.debug === true) {
            log('DEBUG: send_slack_image()');
            log('title:' + title);
            log('message:' + message);
            log('image:' + filename);
            // return;
        }

        let options = {
            token: config.slack.token,
            title: title,
            content: message,
            filename: filename,
            file: JSON.stringify(content),
            channels: config.slack.channel,
        };

        console.log(options);

        let retry = 1;
        const send_internal = () => {
            log('sending image... ' + retry);
            let req = request.post(
                {url: slack_api_uri + 'files.upload', formData: options},
                (error, response, body) => {
                    if (!error && response.statusCode == 200) {
                        log('done');
                        log(JSON.stringify(response));
                        return resolve();
                    } else {
                        retry++;
                        if (retry > 10) {
                            log('max retry error on send_slack_image() ' + title + ' / ' + message +
                                '/' + filename);
                            return reject(new Error('send_slack_image() error'));
                        } else {
                            log('send error ' + response.statusCode + ' / ' + body);
                            setTimeout(
                                () => { send_internal(); },
                                retry * retry * retry * 1000);  // 1sec to 1000sec
                        }
                    }
                });
        };
        send_internal();
    });
};

const send_slack = (title, message) => {
    return new Promise((resolve, reject) => {
        if (config.debug === true) {
            log('DEBUG: send_slack()');
            log('title:' + title);
            log('message:' + message);
            // return;
        }

        let body = {
            attachments: [
                {
                  title: title,
                  text: message,
                },
            ],
        };
        let options = {
            url: config.slack.api,
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            json: body,
        };

        let retry = 1;
        const send_internal = () => {
            log('sending text ... ' + retry);
            request(options, (error, response, body) => {
                if (!error && response.statusCode == 200) {
                    log('done');
                    return resolve();
                } else {
                    retry++;
                    if (retry > 10) {
                        log('max retry error on send_slack() ' + title + ' / ' + message + '/' +
                            filename);
                        return reject(new Error('send_slack() error'));
                    } else {
                        log('send error ' + response.statusCode + ' / ' + body);
                        setTimeout(
                            () => { send_internal(); },
                            retry * retry * retry * 1000);  // 1sec to 1000sec
                    }
                }
            });
        };

        send_internal();
    });
};

imap_connect();

//
