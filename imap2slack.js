#!/usr/bin/env node

'use strict';

const log = msg => {
  console.log((new Date()).toString() + ': ' + msg);
}

// -- MAIL

const Inbox = require('inbox');
const MailParser = require('mailparser').MailParser;
const fs = require('fs');
const request = require('request');
const config = require('/data/config.js');

let m = {
    retry : 0, // 連続retryカウンタ
    t_retry : 0, // 1時間以内retryカウンタ
    cnt_connect : 0, // コネクト回数
};

const imap_connect = () => {
  const imap = Inbox.createConnection(
    false, 'imap.gmail.com', {
      secureConnection: true,
      auth : config.mail.auth
    }
  );

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
    imap.openMailbox('INBOX', { readOnly : false }, function(error) {
      if (error) {
        log('imap: openMailbox error: ' + error);
        imap.close();
        return;
      }
      imap.search({ unseen : true }, true, function(error, result) {
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
          fetch_mail(t, function(error) {
            check_unseen(list);
          });
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

  imap.on('error', message => {
    log('imap: error\n' + message);
  });

  const fetch_mail = (uid, callback) => {
    const stream = imap.createMessageStream(uid);
    const mailParser = new MailParser();
    mailParser.on('end', mail => {
      mail.uid = uid;
      if (typeof mail.attachments !== 'undefined' && mail.attachments.length > 0) {
        const a = mail.attachments[0];
        const filename = a.fileName;
        const content = a.content;
        const tmpFilename = '/tmp/' + filename;
        fs.writeFile(tmpFilename, content, function (err) {
          if (err)
            return check_mail(mail, null, callback);
          check_mail(mail, tmpFilename, callback);
        });
      } else {
        check_mail(mail, null, callback);
      }
    })
    stream.on('error', () => {
      log('imap: stream error: ' + uid);
      callback({ message : 'stream error' });
    });
    stream.pipe(mailParser)
  }

  const check_mail = (mail, file, callback) => {
    log('imap: check_mail: message\n' +
        'name: ' + mail.from[0].name + ' ' + mail.from[0].address + '\n' +
        'subject: ' + mail.subject);
    if (false && config.debug)
        log('body: ' + mail.text);

    config.mail_filter(mail.from[0].address, mail.subject, mail.text,
        (subject, body) => {
            if (typeof subject !== "undefined" && typeof body !== "undefined") {
                send_slack(subject, body, file);
                imap.addFlags(mail.uid, [ '\\Seen' ],
                    (err, flags) => {
                        callback(err);
                    }
                );
            } else {
                log('imap: IGNORED: ' + mail.uid);// + JSON.stringify(mail));
                if (file != null) {
                    fs.unlinkSync(file);
                }
                callback(null);
            }
        }
    );
  };

  imap.on('new', (message) => {
    log('imap: new:');
    fetch_mail(message.UID, error => {});
  });

  imap.on('error', message => {
    log('imap: error: ' + message);
  });

  log('imap: connect');
  imap.connect();
};

imap_connect();

// -- HANGOUTS

const send_slack = (title, message, imageFilename, retry) => {
  if (typeof retry === 'undefined') {
    retry = 0;
  }
  retry++;

  if (config.debug === true) {
    log("DEBUG:");
    log("title:" + title);
    log("message:" + message);
    log("image:" + imageFilename);
    log("retry:" + retry);
    //return;
  }
  
  if (imageFilename) {
      message += '\nImage is not supported now';
  }

  const body = {
      attachments : [
          {
              title : title,
              text : message,
          },
      ],
  };
  const options = {
      url : config.slack_api,
      method : 'POST',
      headers : { 'Content-Type' : 'application/json' },
      json : body,
  };
  request(options, (error, response, body) => {
      if (!error && response.statusCode == 200) {
          // success!
          // TODO: post image
          if (imageFilename) {
            fs.unlinkSync(imageFilename);
          }
          return;
      } else {
          if (retry > 10) {
              log('max retry error on message ' + title + ' / ' + message + '/' + imageFilename);
              if (imageFilename) {
                fs.unlinkSync(imageFilename);
              }
              return;
          } else {
              log('send error ' + response.statusCode + ' / ' + body);
              setTimeout(() => { send_slack(title, message, imageFilename, retry); },
                retry * retry * retry * 1000); // 1sec to 1000sec
          }
      }
  });
};
