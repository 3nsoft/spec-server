/*
 Copyright (C) 2023 3NSoft Inc.
 
 This program is free software: you can redistribute it and/or modify it under
 the terms of the GNU General Public License as published by the Free Software
 Foundation, either version 3 of the License, or (at your option) any later
 version.
 
 This program is distributed in the hope that it will be useful, but
 WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 See the GNU General Public License for more details.
 
 You should have received a copy of the GNU General Public License along with
 this program. If not, see <http://www.gnu.org/licenses/>.
*/

import { CliUsageDisplay, CommandDef, OptionDef, UsageSection, helpOpt, parseArgv, toErrorUsage, toUsageDisplay } from "./utils";


export const runCmd: CommandDef<'run'> = {
	name: 'run',
	summary: 'runs 3NWeb services'
};

function runUsage(execName: string): UsageSection[] {
	return [
		{
			content: `This command runs some or all 3NWeb services. Configuration is read from a yaml file.`
		},
		{
			header: 'Usage:',
			content: `${execName} ${runCmd.name} [options] [config_file]`
		},
		{
			header: 'Options:',
			optionList: runOpts
		}
	];
}

const runOpts: OptionDef[] = [
	{
		name: 'config',
		alias: 'c',
		type: String,
		typeLabel: '{underline <file>}',
		description: `path of a configuration yaml file`
	},
	helpOpt
];

export interface ParsedRunArgs {
	config?: string;
	help?: boolean;
}

export function parseRunArgs(args: string[], execName: string): {
	runCmd?: ParsedRunArgs;
	showUsage?: CliUsageDisplay;
} {
	if (args.length === 0) {
		return toUsageDisplay(0, runUsage(execName));
	}
	const runArgs = parseArgv<ParsedRunArgs>(args, runOpts, { partial: true });
	if (runArgs.help) {
		return toUsageDisplay(0, runUsage(execName));
	} else if (runArgs.config) {
		return { runCmd: runArgs };
	} else if (runArgs._unknown) {
		return { runCmd: { config: runArgs._unknown[0] } };
	} else {
		return toUsageDisplay(-1, toErrorUsage(
			runUsage(execName),
			`Missing configuration file path.`
		));
	}
}


Object.freeze(exports);