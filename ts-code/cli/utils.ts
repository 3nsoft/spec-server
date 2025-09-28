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

import * as commandLineArgs from "command-line-args";
import * as commandLineUsage from "command-line-usage";

export interface CommandDef<T extends string> {
	name: T;
	summary: string;
}

export interface OptionDef {
	name: string;
	type: (typeof Boolean) | (typeof String) | (typeof Number) |
	((value: string) => any);
	alias?: string;
	description?: string;
	typeLabel?: string;
	multiple?: boolean;
	defaultOption?: boolean;
}

export interface UsageSection {
	header?: string;
	summary?: string;
	optionList?: OptionDef[];
	content?: string | UsageSectionContent | (string | UsageSection)[];
}

export interface UsageSectionContent {
	options: any;
	data: any
}

export interface ParseOptions {
	argv?: string[];
	partial?: boolean;
	stopAtFirstUnknown?: boolean;
	camelCase?: boolean;
	caseInsensitive?: boolean;
}

export interface CliUsageDisplay {
	txtToDisplay: string;
	exitStatus: number;
}

export const helpOpt: OptionDef = {
	name: 'help',
	alias: 'h',
	type: Boolean,
	description: 'shows help'
};

export interface HelpArg {
	help?: boolean;
}

export function toUsageDisplay(
	exitStatus: number, usage: UsageSection[]
): {
	showUsage: CliUsageDisplay;
} {
	return {
		showUsage: {
			txtToDisplay: commandLineUsage(usage),
			exitStatus
		}
	};
}

export function parseArgv<T>(
	argv: string[], argOpts: OptionDef[], opts?: ParseOptions
): T & { _unknown?: string[]; } {
	if (opts) {
		opts.argv = argv;
	} else {
		opts = { argv };
	}
	return commandLineArgs(argOpts, opts);
}

export function toErrorUsage(
	usage: UsageSection[], errTxt: string
): UsageSection[] {
	usage[0] = { content: errTxt };
	return usage;
}


Object.freeze(exports);