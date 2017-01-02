/*
 Copyright (C) 2016 3NSoft Inc.
 
 This program is free software: you can redistribute it and/or modify it under
 the terms of the GNU General Public License as published by the Free Software
 Foundation, either version 3 of the License, or (at your option) any later
 version.
 
 This program is distributed in the hope that it will be useful, but
 WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 See the GNU General Public License for more details.
 
 You should have received a copy of the GNU General Public License along with
 this program. If not, see <http://www.gnu.org/licenses/>. */

import { resolve } from 'path';
import { readdirSync } from 'fs';

export interface GenericSpecDescribe<TSetup> {
	description: string;
	definition?: (setup: () => TSetup) => (() => void);
	focused?: boolean;
}

type ExportedSpecs<TSetup> =
	GenericSpecDescribe<TSetup> | GenericSpecDescribe<TSetup>[]

function setupSpecs<TSetup>(specs: GenericSpecDescribe<TSetup>,
		setup: () => TSetup): void {
	if (!specs.definition) { return; }
	if (specs.focused) {
		fdescribe(specs.description, specs.definition(setup));
	} else {
		describe(specs.description, specs.definition(setup));			
	}
}

export function addSpecsFrom<TSetup>(specsFolder: string,
		setup: () => TSetup): void {
	for (let fName of readdirSync(specsFolder)) {
		let modPath = resolve(specsFolder, fName);
		let specs: ExportedSpecs<TSetup> = require(modPath).specs;
		if (!specs) {
			console.error(`Module ${fName} is not exposing specs objects with tests`);
			continue;
		}
		if (Array.isArray(specs)) {
			for (let s of specs) {
				setupSpecs(s, setup);
			}
		} else {
			setupSpecs(specs, setup);
		}
	}
}

Object.freeze(exports);