/**
 * @license imap2slack
 * (c) 2020 Bugfire https://bugfire.dev/
 * License: MIT
 */

import * as fs from "fs";
import * as Inbox from "inbox";
import { simpleParser, ParsedMail } from "mailparser";

import type { Config } from "./config";
import type { Logger } from "./logger";
import { sleep } from "./sleep";
import { slackPostMessage } from "./slack_post_message";
import { slackPostImage } from "./slack_post_image";
import { mailFilter } from "./mail_filter";

const config = JSON.parse(fs.readFileSync("/config/config.json", "utf8")) as Config;

const outputLog = (msg: string): void => {
  const n = new Date(new Date().getTime() + 9 * 3600 * 1000);
  const f = (len: number, target: number): string => {
    return `0000${target}`.substr(-len);
  };
  const dateStr =
    `${f(2, n.getUTCHours())}:${f(2, n.getUTCMinutes())}:` + +`${f(2, n.getUTCSeconds())}.${f(3, n.getMilliseconds())}`;
  console.log(`${dateStr}: ${msg}`);
};

const logger: Logger = {
  debug: (msg: string): void => {
    if (!config.debug) {
      return;
    }
    outputLog(msg);
  },
  info: (msg: string): void => {
    outputLog(msg);
  },
};

class ImapChecker {
  private imap: Inbox.IMAPClient | null = null;
  private connectSerialNumber = 0; // コネクト回数
  private connectCounter = 0; // 連続retryカウンタ
  private connectCounterFor1hour = 0; // 1時間以内retryカウンタ

  public constructor() {
    logger.info("ImapChecker.constructor:");
    this.connect();
  }

  private connect(): void {
    logger.info("ImapChecker.connect:");
    this.imap = Inbox.createConnection(false, config.mail.host, {
      secureConnection: true,
      auth: config.mail.auth,
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

  private async checkMail(uid: string): Promise<void> {
    logger.info(`ImapChecker.checkMail: uid=${uid}`);
    const mail = await this.readMail(uid);

    logger.info(`  from: "${mail.from?.value[0].name}" <"${mail.from?.value[0].address}">`);
    logger.info(`  subject: ${mail.subject}`);

    const r = mailFilter({
      config,
      logger,
      mail: {
        from: mail.from?.value[0].address ?? "",
        subject: mail.subject ?? "",
        body: mail.text ?? "",
      },
    });
    if (r !== null) {
      const { subject, body } = r;
      await slackPostMessage({ config, logger, subject, body });
      if (typeof mail.attachments !== "undefined" && mail.attachments.length > 0 && mail.attachments[0].content) {
        const a = mail.attachments[0];
        const filename = `${new Date().toISOString()}-${a.filename}`;
        await slackPostImage({ config, logger, filename, content: a.content });
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
    logger.info("ImapChecker.onConnect:");
    this.connectSerialNumber++;
    this.connectCounter = 0;

    // 1時間次のコネクトしなければretryCounterFor1hourをリセット
    ((t: number): void => {
      setTimeout(() => {
        if (t == this.connectSerialNumber) {
          logger.info("ImapChecker.onConnect: resetted retryCounterFor1hour");
          this.connectCounterFor1hour = 0;
        }
      }, 3600 * 1000);
    })(this.connectSerialNumber);

    try {
      await this.openMailBox("INBOX", { readOnly: false });
    } catch (e) {
      logger.info(`ImapChecker.onConnect: openMailbox error: ${e}`);
      if (this.imap !== null) {
        this.imap.close();
        this.imap = null;
      }
      return;
    }

    let unseenMails: string[];
    try {
      unseenMails = await this.searchMail({ unseen: true }, true);
      logger.info(`ImapChecker.onConnect: unseen: ${JSON.stringify(unseenMails)}`);
    } catch (e) {
      logger.info(`ImapChecker.onConnect: searchMail error: ${e}`);
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
    } catch (e: any) {
      logger.info(`ImapChecker.onConnect: checkMail error: ${e} ${e.stack}`);
      if (this.imap !== null) {
        this.imap.close();
        this.imap = null;
      }
      return;
    }
  }

  private async onClose(): Promise<void> {
    logger.info("ImapChecker.onClose:");

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

    logger.info("ImapChecker.onClose: trying to re-connect");
    this.connectCounter++;
    this.connectCounterFor1hour++;
    this.connect();
  }

  private onError(message: string): void {
    logger.info(`ImapChecker.onError: ${message}`);
  }

  private async onNew(message: { UID: string }): Promise<void> {
    logger.info(`ImapChecker.onNew: ${JSON.stringify(message)}`);
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

  private openMailBox(name: string, flags: { readOnly: boolean }): Promise<void> {
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

  private searchMail(flags: { unseen: boolean }, arg2: boolean): Promise<string[]> {
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
