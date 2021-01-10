import axios from "axios";

import type { Config } from "./config";
import type { Logger } from "./logger";
import { sleep } from "./sleep";

const SLACK_API_URI = "https://slack.com/api/";

export const slackPostMessage = async (
  args: Readonly<{
    config: Config;
    logger: Logger;
    subject: string;
    body: string;
  }>
): Promise<void> => {
  const { config, logger, subject, body } = args;

  logger.debug("Slack.postMessage:");
  logger.debug(`  subject: ${subject}`);
  logger.debug(`  channel: ${config.slack.channel_id}`);

  const text = body.replace(new RegExp(/\s*\n/, "g"), "\n").replace(new RegExp(/\n+$/), "");
  logger.debug(`\n---message---\n${text}\n-------------`);

  const postBody = {
    channel: config.slack.channel_id,
    attachments: [
      {
        title: subject,
        text,
      },
    ],
  };

  const option = {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.slack.token}`,
    },
    timeout: 30 * 1000,
  };

  if (config.dryrun) {
    return;
  }

  for (let retry = 1; retry <= 5; retry++) {
    logger.info(`Slack.postMessage: Sending text... count:${retry}`);
    try {
      const r = await axios.post(`${SLACK_API_URI}chat.postMessage`, postBody, option);
      if (r.status === 200) {
        logger.info("Slack.postMessage: done");
        logger.debug(`\n---payload---\n${JSON.stringify(r.data)}\n-------------`);
        return;
      } else {
        logger.info(`Slack.postMessage: error status=${r.status} / ${text}`);
      }
    } catch (e) {
      logger.info(`Slack.postMessage: error=${e} / ${text}`);
    }
    await sleep(retry * retry * retry * 1000); // 1sec to 1000sec
  }
  throw new Error(`Slack.postMessage: Max retry error ${subject} / ${text}`);
};
