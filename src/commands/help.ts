import { Message } from 'whatsapp-web.js';
import text from '../language';
import { LANGUAGE, PREFIX } from '../config';
import commands from '.';

export default {
  run: async (message: Message, keyword: string): Promise<Message> => {
    if (!keyword)
      return message.reply(
        `${text[LANGUAGE].AVAILABLE_COMMANDS}: ${Object.keys(commands).join(
          ', ',
        )}`,
      );
    try {
      type CommandKey = keyof typeof commands;
      const commandKey = `${PREFIX}${keyword}` as CommandKey;
      const commandEntry = commands[commandKey];
      const helpText = (commandEntry as { help?: string })?.help ?? text[LANGUAGE].ERROR;
      return message.reply(helpText);
    } catch (error) {
      return message.reply(`${text[LANGUAGE].ERROR}`);
    }
  },
  help: text[LANGUAGE].HELP_HELP,
};
