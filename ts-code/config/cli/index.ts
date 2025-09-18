/*
 Copyright (C) 2023, 2025 3NSoft Inc.
 
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

import { EXECUTABLE_NAME } from "../default-confs";
import { ParsedRunArgs, parseRunArgs, runCmd } from "./run-cmd";
import { ParsedSignupArgs, parseSignupArgs, signupCmd } from "./signup-cmd";
import { CliUsageDisplay, HelpArg, UsageSection, helpOpt, parseArgv, toErrorUsage, toUsageDisplay } from "./utils";

export { CliUsageDisplay } from "./utils";

function mainUsage(execName: string): UsageSection[] {
	return [
		{
			header: execName,
			content: `Server of all 3NWeb utilities: MailerId, ASMail, 3NStorage.`
		},
		{
			header: `Usage:`,
			content: `${execName} [command]`
		},
		{
			header: 'Available commands:',
			content: [
				runCmd,
				signupCmd
			]
		},
		{
			header: '',
			content: `Use "${execName} [command] --help" for more information about a command.`
		}
	];
}

export function parseProcessArgv(): {
	runCmd?: ParsedRunArgs;
	signupCmd?: ParsedSignupArgs;
	showUsage?: CliUsageDisplay;
} {
	const args = process.argv.slice(2);
	if (args.length === 0) {
		return toUsageDisplay(0, mainUsage(EXECUTABLE_NAME));
	}
	if (args[0] === runCmd.name) {
		return parseRunArgs(args.slice(1), EXECUTABLE_NAME);
	} else if (args[0] === signupCmd.name) {
		return parseSignupArgs(args.slice(1), EXECUTABLE_NAME);
	} else {
		const opts = parseArgv<HelpArg>(args, [ helpOpt ], { partial: true });
		if (opts.help) {
			return toUsageDisplay(0, mainUsage(EXECUTABLE_NAME));
		}
		return toUsageDisplay(-1, toErrorUsage(
			mainUsage(EXECUTABLE_NAME),
			`Unknown command '${args[0]}'`
		));
	}
}


Object.freeze(exports);