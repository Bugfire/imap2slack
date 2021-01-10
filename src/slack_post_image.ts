import * as FormData from "form-data";
import axios from "axios";

import type { Config } from "./config";
import type { Logger } from "./logger";
import { sleep } from "./sleep";

const SLACK_API_URI = "https://slack.com/api/";

export const slackPostImage = async (
  args: Readonly<{
    config: Config;
    logger: Logger;
    filename: string;
    content: Buffer;
  }>
): Promise<void> => {
  const { config, logger, filename, content } = args;

  logger.debug("Slack.postImage:");
  logger.debug(`  image: ${filename} / ${content.length}`);
  logger.debug(`  channel: ${config.slack.channel_id}`);

  const form = new FormData();
  form.append("token", config.slack.token);
  form.append("channels", config.slack.channel_id);
  form.append("file", content, filename);
  form.append("title", filename);

  if (config.dryrun) {
    return;
  }

  for (let retry = 1; retry <= 5; retry++) {
    logger.info(`Slack.postImage: Sending image... count:${retry}`);
    try {
      const r = await axios.post(`${SLACK_API_URI}files.upload`, form, {
        headers: form.getHeaders(),
      });
      if (r.status === 200) {
        logger.info("Slack.postImage: done");
        logger.debug(`\n---payload---\n${JSON.stringify(r.data)}\n-------------`);
        return;
      } else {
        logger.info(`Slack.postImage: error status=${r.status} / ${filename}`);
      }
    } catch (e) {
      logger.info(`Slack.postImage: error=${e} / ${filename}`);
    }
    await sleep(retry * retry * retry * 1000); // 1sec to 1000sec
  }
  throw new Error(`Slack.postImage: Max retry error ${filename}`);
};
