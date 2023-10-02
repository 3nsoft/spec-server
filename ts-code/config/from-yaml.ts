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

import { readFileSync } from 'fs';
import * as yaml from 'js-yaml';
import { Configurations } from '../services';


export function readYamlConfFile(path: string): Configurations {
	const txt = readFileSync(path, 'utf8');
	const conf = yaml.load(txt);

	return conf;
}


Object.freeze(exports);