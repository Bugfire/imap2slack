/**
 * @license imap2slack
 * (c) 2020 Bugfire https://bugfire.dev/
 * License: MIT
 */

declare module "inbox" {
  import * as Inbox from "inbox";
  import * as Stream from "stream";

  type createConnectionOptions = {
    secureConnection: boolean;
    auth: { user: string; pass: string };
    debug?: debugArgument;
  };

  type openMailboxOptions = {
    readOnly?: boolean;
  };

  type falsable = false | null | undefined | "" | 0;
  type truable = true | 1;
  type portArgument = falsable | number;
  type hostArgument = falsable | string;
  type debugArgument = falsable | truable;

  /*
  export class Mailbox {
    path: string;
    flags?: string[];
    UIDValidity?: string;
    UIDNext: string;
    highestModSeq?: number;
    unseen?: boolean;
    permanentFlags?: string[];
    count?: number;
    readOnly?: boolean;
  }
  */

  // eslint-disable-next-line @typescript-eslint/interface-name-prefix
  export class IMAPClient {
    constructor(
      port: portArgument,
      host: hostArgument,
      options: createConnectionOptions
    );

    connect(): void;

    // listMailboxes(): void;

    /*
    openMailbox(
      path: string | { path: string },
      callback: (error: Error) => void
    ): void;
    */

    openMailbox(
      path: string | { path: string },
      options: openMailboxOptions,
      callback: (error: Error) => void
    ): void;

    /*
    getCurrentMailbox(): Mailbox;

    listMessages(from: number, callback: () => void): void;
    listMessages(from: number, limit: number, callback: (error: Error | null, mailList?: mailList) => void): void;
    listMessages(
      from: number,
      limit: number,
      extendedOptions: string,
      callback: () => void
    ): void;

    listMessagesByUID(from: number, to: number, callback: () => void)
    */

    on(event: "connect", handler: () => void): void;
    on(event: "close", handler: () => void): void;
    on(event: "error", handler: (message: string) => void): void;
    on(event: "new", handler: (message: { UID: string }) => void): void;

    close(): void;
    createMessageStream(uid: string): Stream;
    addFlags(
      uid: string,
      flags: string[],
      callback: (error: Error) => void
    ): void;
    search(
      query: { unseen: boolean },
      isUid: boolean,
      callback: (error: Error, result: string[]) => void
    ): void;
  }

  export function createConnection(
    port: portArgument,
    host: hostArgument,
    options: createConnectionOptions
  ): IMAPClient;

  // createXOAuthGenerator
}
