/**
 * @license imap2slack
 * (c) 2020 Bugfire https://bugfire.dev/
 * License: MIT
 */

import * as fs from "fs";
import * as Inbox from "inbox";
import * as FormData from "form-data";
import { simpleParser, ParsedMail } from "mailparser";
import axios from "axios";

interface MailContent {
  from: string;
  subject: string;
  body: string;
}

interface FilterReplace {
  regex: string;
  replace: string;
}

interface FilterDeny {
  cond: "deny";
  from?: string;
  subject?: string;
  body?: string;
}

interface FilterAllow {
  cond: "allow";
  from?: string;
  subject?: string;
  body?: string;
  subjectFilter?: FilterReplace;
  bodyFilter?: FilterReplace;
}

interface Config {
  mail: {
    host: string;
    auth: {
      user: string;
      pass: string;
    };
  };
  slack: {
    webhook: string;
    channel_name: string;
    channel_id: string;
    token: string;
  };
  filter: (FilterAllow | FilterDeny)[];
  debug?: boolean;
  dryrun?: boolean;
}

const config = JSON.parse(
  fs.readFileSync("/config/config.json", "utf8")
) as Config;

const outputLog = (msg: string): void => {
  const n = new Date(new Date().getTime() + 9 * 3600 * 1000);
  const f = (len: number, target: number): string => {
    return `0000${target}`.substr(-len);
  };
  const dateStr =
    `${f(2, n.getUTCHours())}:${f(2, n.getUTCMinutes())}:` +
    +`${f(2, n.getUTCSeconds())}.${f(3, n.getMilliseconds())}`;
  console.log(`${dateStr}: ${msg}`);
};

const debugLog = (msg: string): void => {
  if (!config.debug) {
    return;
  }
  outputLog(msg);
};

const infoLog = (msg: string): void => {
  outputLog(msg);
};

const sleep = (waitMsec: number): Promise<void> => {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve();
    }, waitMsec);
  });
};

// -- Slack

class Slack {
  private static SLACK_API_URI = "https://slack.com/api/";

  public static async postMessage(
    title: string,
    message: string
  ): Promise<void> {
    debugLog("Slack.postMessage:");
    debugLog(`  title: ${title}`);
    debugLog(`  channel: ${config.slack.channel_name}`);

    message = message.replace(new RegExp(/\s*\n/, "g"), "\n");
    message = message.replace(new RegExp(/\n+$/), "");
    debugLog(`\n---message---\n${message}\n-------------`);

    const body = {
      attachments: [
        {
          title: title,
          text: message,
          channel: config.slack.channel_name
        }
      ]
    };
    const option = {
      headers: {
        "Content-Type": "application/json"
      },
      timeout: 30 * 1000
    };

    if (config.dryrun) {
      return;
    }

    for (let retry = 1; retry <= 10; retry++) {
      infoLog(`Slack.postMessage: Sending text... count:${retry}`);
      try {
        const r = await axios.post(config.slack.webhook, body, option);
        if (r.status === 200) {
          infoLog("Slack.postMessage: done");
          debugLog(`\n---payload---\n${JSON.stringify(r.data)}\n-------------`);
          return;
        } else {
          infoLog(`Slack.postMessage: error status=${r.status} / ${message}`);
        }
      } catch (e) {
        infoLog(`Slack.postMessage: error=${e} / ${message}`);
      }
      await sleep(retry * retry * retry * 1000); // 1sec to 1000sec
    }
    throw new Error(`Slack.postMessage: Max retry error ${title} / ${message}`);
  }

  public static async postImage(
    filename: string,
    content: Buffer
  ): Promise<void> {
    debugLog("Slack.postImage:");
    debugLog(`  image: ${filename} / ${content.length}`);
    debugLog(`  channel: ${config.slack.channel_id}`);

    const form = new FormData();
    form.append("token", config.slack.token);
    form.append("channels", config.slack.channel_id);
    form.append("file", content, filename);
    form.append("title", filename);

    if (config.dryrun) {
      return;
    }

    for (let retry = 1; retry <= 10; retry++) {
      infoLog(`Slack.postImage: Sending image... count:${retry}`);
      try {
        const r = await axios.post(`${this.SLACK_API_URI}files.upload`, form, {
          headers: form.getHeaders()
        });
        if (r.status === 200) {
          infoLog("Slack.postImage: done");
          debugLog(`\n---payload---\n${JSON.stringify(r.data)}\n-------------`);
          return;
        } else {
          infoLog(`Slack.postImage: error status=${r.status} / ${filename}`);
        }
      } catch (e) {
        infoLog(`Slack.postImage: error=${e} / ${filename}`);
      }
      await sleep(retry * retry * retry * 1000); // 1sec to 1000sec
    }
    throw new Error(`Slack.postImage: Max retry error ${filename}`);
  }
}

class ImapChecker {
  private imap: Inbox.IMAPClient | null = null;
  private connectSerialNumber = 0; // コネクト回数
  private connectCounter = 0; // 連続retryカウンタ
  private connectCounterFor1hour = 0; // 1時間以内retryカウンタ

  public constructor() {
    infoLog("ImapChecker.constructor:");
    this.connect();
  }

  private connect(): void {
    infoLog("ImapChecker.connect:");
    this.imap = Inbox.createConnection(false, config.mail.host, {
      secureConnection: true,
      auth: config.mail.auth
    });
    if (this.imap !== null) {
      this.imap.on("connect", () => {
        this.onConnect();
      });
      this.imap.on("close", () => this.onClose());
      this.imap.on("error", (message: string) => this.onError(message));
      this.imap.on("new", (message: { UID: string }) => this.onNew(message));
      this.imap.connect();
    }
  }

  private mailFilter(mail: MailContent): MailContent | null {
    for (let i = 0; i < config.filter.length; i++) {
      const filter = config.filter[i];
      let match = true;
      if (typeof filter.from !== "undefined") {
        if (!mail.from.match(new RegExp(filter.from))) {
          debugLog(
            `mailFilter: dont match "${mail.from}" for "${filter.from}"`
          );
          match = false;
        }
      }
      if (match && typeof filter.subject !== "undefined") {
        if (!mail.subject.match(new RegExp(filter.subject))) {
          debugLog(
            `mailFilter: dont match "${mail.subject}" for "${filter.subject}"`
          );
          match = false;
        }
      }
      if (match && typeof filter.body !== "undefined") {
        if (!mail.body.match(new RegExp(filter.body))) {
          debugLog(`mailFilter: dont match for "${filter.body}"`);
          debugLog(
            `\n-----body----\n${JSON.stringify(mail.body)}\n-------------`
          );
          match = false;
        }
      }
      switch (filter.cond) {
        case "allow":
          if (match) {
            debugLog(`mailFilter: matched rule ${JSON.stringify(filter)}`);
            const r = {
              from: mail.from,
              subject: mail.subject,
              body: mail.body
            };
            if (typeof filter.subjectFilter !== "undefined") {
              r.subject = r.subject.replace(
                new RegExp(filter.subjectFilter.regex, "g"),
                filter.subjectFilter.replace
              );
            }
            if (typeof filter.bodyFilter !== "undefined") {
              r.body = r.body.replace(
                new RegExp(filter.bodyFilter.regex, "g"),
                filter.bodyFilter.replace
              );
            }
            return r;
          }
          break;
        case "deny":
          if (match) {
            return null;
          }
          break;
        default:
          throw new Error(
            `Unknown filter definition ${JSON.stringify(filter)}`
          );
      }
    }
    return mail;
  }

  private async checkMail(uid: string): Promise<void> {
    infoLog(`ImapChecker.checkMail: uid=${uid}`);
    const mail = await this.readMail(uid);

    infoLog(
      `  from: "${mail.from.value[0].name}" <"${mail.from.value[0].address}">`
    );
    infoLog(`  subject: ${mail.subject}`);

    const r = this.mailFilter({
      from: mail.from.value[0].address,
      subject: mail.subject,
      body: mail.text
    });
    if (r !== null) {
      await Slack.postMessage(r.subject, r.body);
      if (
        typeof mail.attachments !== "undefined" &&
        mail.attachments.length > 0 &&
        mail.attachments[0].content
      ) {
        const a = mail.attachments[0];
        const filename = `${new Date().toISOString()}-${a.filename}`;
        await Slack.postImage(filename, a.content);
      }
    }

    if (config.dryrun || this.imap === null) {
      // ちゃんとやるなら、connect の後でunseenチェックの前に実行するリストにでも加える。
      return;
    }

    this.imap.addFlags(uid, ["\\Seen"], (err: Error) => {
      if (err !== null) {
        throw err;
      }
    });
  }

  // imap event handlers

  private async onConnect(): Promise<void> {
    infoLog("ImapChecker.onConnect:");
    this.connectSerialNumber++;
    this.connectCounter = 0;

    // 1時間次のコネクトしなければretryCounterFor1hourをリセット
    ((t: number): void => {
      setTimeout(() => {
        if (t == this.connectSerialNumber) {
          infoLog("ImapChecker.onConnect: resetted retryCounterFor1hour");
          this.connectCounterFor1hour = 0;
        }
      }, 3600 * 1000);
    })(this.connectSerialNumber);

    try {
      await this.openMailBox("INBOX", { readOnly: false });
    } catch (e) {
      infoLog(`ImapChecker.onConnect: openMailbox error: ${e}`);
      if (this.imap !== null) {
        this.imap.close();
        this.imap = null;
      }
      return;
    }

    let unseenMails: string[];
    try {
      unseenMails = await this.searchMail({ unseen: true }, true);
      infoLog(`ImapChecker.onConnect: unseen: ${JSON.stringify(unseenMails)}`);
    } catch (e) {
      infoLog(`ImapChecker.onConnect: searchMail error: ${e}`);
      if (this.imap !== null) {
        this.imap.close();
        this.imap = null;
      }
      return;
    }

    try {
      for (let i = 0; i < unseenMails.length; i++) {
        await this.checkMail(unseenMails[i]);
        await sleep(1000);
      }
    } catch (e) {
      infoLog(`ImapChecker.onConnect: checkMail error: ${e}`);
      if (this.imap !== null) {
        this.imap.close();
        this.imap = null;
      }
      return;
    }
  }

  private async onClose(): Promise<void> {
    infoLog("ImapChecker.onClose:");

    let wait;
    if (this.connectCounter == 0 && this.connectCounterFor1hour < 10) {
      wait = 10 * 1000;
    } else if (this.connectCounter < 10 && this.connectCounterFor1hour < 20) {
      wait = 60 * 1000;
    } else {
      wait = 120 * 1000;
    }

    this.imap = null;
    await sleep(wait);

    infoLog("ImapChecker.onClose: trying to re-connect");
    this.connectCounter++;
    this.connectCounterFor1hour++;
    this.connect();
  }

  private onError(message: string): void {
    infoLog(`ImapChecker.onError: ${message}`);
  }

  private async onNew(message: { UID: string }): Promise<void> {
    infoLog(`ImapChecker.onNew: ${JSON.stringify(message)}`);
    await this.checkMail(message.UID);
  }

  // Promisify imap functions

  private async readMail(uid: string): Promise<ParsedMail> {
    if (this.imap === null) {
      throw new Error("ImapChecker.readMail: imap === null");
    }

    const stream = this.imap.createMessageStream(uid);
    const r = await simpleParser(stream);

    return r;
  }

  private openMailBox(
    name: string,
    flags: { readOnly: boolean }
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.imap === null) {
        throw new Error("ImapChecker.openMailBox: imap === null");
      }
      this.imap.openMailbox(name, flags, (error: Error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  private searchMail(
    flags: { unseen: boolean },
    arg2: boolean
  ): Promise<string[]> {
    return new Promise((resolve, reject) => {
      if (this.imap === null) {
        throw new Error("ImapChecker.searchMail: imap === null");
      }
      this.imap.search(flags, arg2, (error: Error, result: string[]): void => {
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      });
    });
  }
}

new ImapChecker();
