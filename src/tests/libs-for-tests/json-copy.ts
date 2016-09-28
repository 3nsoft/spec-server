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

export function copy<T>(orig: T): T {
	if (typeof orig !== 'object') { return orig; }
	if (orig === null) { return null; }
	if (Array.isArray(orig)) {
		let arr: any[] = <any> orig;
		let c = [];
		for (let i=0; i < arr.length; i+=1) {
			c[i] = copy(arr[i]);
		}
		return <any> c;
	} else {
		let c = <T> {};
		let fields = Object.keys(orig);
		for (let f of fields) {
			c[f] = copy<any>(orig[f]);
		}
		return c;
	}
}

Object.freeze(exports);