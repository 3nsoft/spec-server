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

import { CliUsageDisplay, CommandDef, UsageSection, toUsageDisplay } from "./utils";

export const userCmd: CommandDef<'user'> = {
	name: 'user',
	summary: 'provides information about existing users'
};

const listCmd: CommandDef<'list'> = {
	name: 'list',
	summary: `lists users`
}

export interface ParsedUserArgs {
	listAll?: true;
}

function userUsage(execName: string): UsageSection[] {
	return [
		{
			header: execName,
			content: `Server of all 3NWeb utilities: MailerId, ASMail, 3NStorage.`
		},
		{
			header: `Usage:`,
			content: `${execName} user [command]`
		},
		{
			header: 'Available commands:',
			content: []
		},
		{
			content: `Use "${execName} user [command] --help" for more information about a command.`
		}
	];
}

export function parseSignupArgs(
	args: string[], execName: string
): {
	userCmd?: ParsedUserArgs;
	showUsage?: CliUsageDisplay;
} {
	if (args.length === 0) {
		return toUsageDisplay(0, userUsage(execName));
	}

	// XXX


	return {};
}
