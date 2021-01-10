import type { Config } from "./config";
import type { Logger } from "./logger";

type MailContent = Readonly<{
  from: string;
  subject: string;
  body: string;
}>;

export const mailFilter = (
  args: Readonly<{ config: Config; logger: Logger; mail: MailContent }>
): MailContent | null => {
  const { config, logger, mail } = args;
  for (let i = 0; i < config.filter.length; i++) {
    const filter = config.filter[i];
    let match = true;

    if (typeof filter.from !== "undefined") {
      if (!mail.from.match(new RegExp(filter.from))) {
        logger.debug(`mailFilter: dont match "${mail.from}" for "${filter.from}"`);
        match = false;
      }
    }

    if (match && typeof filter.subject !== "undefined") {
      if (!mail.subject.match(new RegExp(filter.subject))) {
        logger.debug(`mailFilter: dont match "${mail.subject}" for "${filter.subject}"`);
        match = false;
      }
    }

    if (match && typeof filter.body !== "undefined") {
      if (!mail.body.match(new RegExp(filter.body))) {
        logger.debug(`mailFilter: dont match for "${filter.body}"`);
        logger.debug(`\n-----body----\n${JSON.stringify(mail.body)}\n-------------`);
        match = false;
      }
    }

    switch (filter.cond) {
      case "allow":
        if (match) {
          logger.debug(`mailFilter: matched rule ${JSON.stringify(filter)}`);
          const r = {
            from: mail.from,
            subject: mail.subject,
            body: mail.body,
          };
          if (typeof filter.subjectFilter !== "undefined") {
            r.subject = r.subject.replace(new RegExp(filter.subjectFilter.regex, "g"), filter.subjectFilter.replace);
          }
          if (typeof filter.bodyFilter !== "undefined") {
            r.body = r.body.replace(new RegExp(filter.bodyFilter.regex, "g"), filter.bodyFilter.replace);
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
        throw new Error(`Unknown filter definition ${JSON.stringify(filter)}`);
    }
  }

  return mail;
};
