import { commands } from '../stores';

export interface SubCommand {
  text: string;
  onClick: Function;
}

export interface GlobalCommand {
  id: string;
  text: string;
  getSubCommands?: () => SubCommand[];
  onClick?: Function;
  enabledStore?: any;
  icon?: string;
  toolbar?: boolean;
  enabled?: boolean;
}

export default function registerCommand(command: GlobalCommand) {
  const { enabledStore } = command;
  commands.update(x => ({
    ...x,
    [command.id]: {
      ...command,
      enabled: !enabledStore,
    },
  }));
  if (enabledStore) {
    enabledStore.subscribe(value => {
      commands.update(x => ({
        ...x,
        [command.id]: {
          ...x[command.id],
          enabled: value,
        },
      }));
    });
  }
}
