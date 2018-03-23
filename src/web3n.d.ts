/*
 Copyright (C) 2016 - 2017 3NSoft Inc.

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


declare namespace web3n {
	
	interface RuntimeException {
		runtimeException: true;
		type?: string;
		cause?: any;
	}

	interface EncryptionException {
		failedCipherVerification: true;
	}

	/**
	 * This is an input byte stream, in classical lingo.
	 * Its read method provides greater expectation for consumer, than common
	 * streams.
	 * All methods should be usable when called separately from the object, i.e.
	 * all methods must be functions, already bound to some state/closure.
	 */
	interface ByteSource {
		
		// XXX we should add informative method prepareBytes, which sets an
		//		expectation about possible number of bytes that will be read from
		//		this source.
		//		Piped source like decrypting one, may relay respective suggestion to
		//		underlying source.
		//		For sources like file on a disk, it shall be a noop.
		//		This will allow consumer to signal info, which can help upstream
		//		to choose best behaviour, like asking network resource to send bytes
		//		with less of round trips.
		
		/**
		 * This returns a promise of byte array, resolvable when bytes are ready.
		 * There will be less bytes than ordered, when there is no more bytes. 
		 * When the source has already reached its end before this call, promise
		 * resolves to undefined.
		 * @param len is a number of bytes, which should be read from the  source.
		 * If source's end comes earlier, number of returned bytes can be less.
		 * If undefined is given, all bytes to source end must be returned.
		 */
		read(len: number|undefined): Promise<Uint8Array|undefined>;
		
		/**
		 * This returns total number of bytes that come from this byte source.
		 * Returned value can be undefined, if a byte source does not know its
		 * overall size, yet.
		 */
		getSize(): Promise<number|undefined>;
		
		/**
		 * This method sets an offset for the next read.
		 * One may re-read bytes, by seeking back, or skip bytes, by moving
		 * forward.
		 * The method is optional, and its presence depends on implementation.
		 * @param offset is a new internal pointer position, counting from
		 * stream's absolute beginning. 
		 */
		seek?(offset: number): Promise<void>;

		/**
		 * The method is optional, and it is present when seek method is present.
		 * This returns current position in a seekable source.
		 */
		getPosition?(): Promise<number>;
		
	}

	/**
	 * This is an output byte stream, in classical lingo.
	 * Sink sounds simple, as one writes, or dumps bytes into it.
	 * All methods should be usable when called separately from the object, i.e.
	 * all methods must be functions, already bound to some state/closure.
	 */
	interface ByteSink {
		
		/**
		 * This returns a promise, resolvable when write is done.
		 * @param bytes to be dumped into this sink.
		 * When total size has not been set, or was set as unknown, null must be
		 * given to indicate an end of byte stream.
		 * When size is set, it is an error to give more bytes, or to give null,
		 * before giving all bytes.
		 * @param err is an optional parameter, that pushes error along a pipe if
		 * such is setup.
		 */
		write(bytes: Uint8Array|null, err?: any): Promise<void>;

		/**
		 * This returns total number of bytes in a bucket where this sink pumps
		 * bytes. Returned value can be undefined, if a byte sink does not know
		 * its overall size, yet.
		 */
		getSize(): Promise<number|undefined>;
		
		/**
		 * This function can be called only once. Other calls will throw
		 * exceptions.
		 * It returns a promise, resolvable when total sink size is set.
		 * @param size is a total number of bytes, that will be dumped into this
		 * sink. If size is undefined, we explicitly state that size will not be
		 * known till end of stream.
		 */
		setSize(size: number|undefined): Promise<void>;
		
		/**
		 * This method sets an offset for the next write.
		 * One may write bytes at random places, by seeking back to proper
		 * position, together with adjusting total size.
		 * The method is optional, and its presence depends on implementation.
		 * @param offset is a new internal pointer position, counting from sink's
		 * absolute beginning. 
		 */
		seek?(offset: number): Promise<void>;

		/**
		 * The method is optional, and it is present when seek method is present.
		 * This returns current position in a seekable sink.
		 */
		getPosition?(): Promise<number>;
	}

	interface Observer<T> {
		next?: (value: T) => void;
		error?: (err: any) => void;
		complete?: () => void;
	}

}

declare namespace web3n.files {
	
	interface FileException extends RuntimeException {
		code: string|undefined;
		path: string;
		notFound?: true;
		alreadyExists?: true;
		notDirectory?: true;
		notFile?: true;
		notLink?: true;
		isDirectory?: true;
		notEmpty?: true;
		endOfFile?: true;
		inconsistentStateOfFS?: true;
		concurrentUpdate?: true;
	}
	
	interface exceptionCode {
		notFound: 'ENOENT';
		alreadyExists: 'EEXIST';
		notDirectory: 'ENOTDIR';
		notFile: 'ENOTFILE';
		notLink: 'not-link';
		isDirectory: 'EISDIR';
		notEmpty: 'ENOTEMPTY';
		endOfFile: 'EEOF';
		concurrentUpdate: 'concurrent-update';
	}

	/**
	 * Instances of this interface are produced by folder listing method(s).
	 */
	interface ListingEntry {
		
		/**
		 * This is name of an entity in its parent folder.
		 */
		name: string;

		/**
		 * When present with true value, it indicates that an entity is a folder.
		 */
		isFolder?: boolean;

		/**
		 * When present with true value, it indicates that an entity is a file.
		 */
		isFile?: boolean;

		/**
		 * When present with true value, it indicates that an entity is a link.
		 */
		isLink?: boolean;
	}

	interface FileStats {
		
		/**
		 * File size in bytes.
		 */
		size: number | undefined;
		
		/**
		 * Last modification time stamp.
		 * If such information cannot be provided, this field will be absent.
		 */
		mtime?: Date;

		/**
		 * This tells object's version.
		 * If such information cannot be provided, this field will be absent.
		 */
		version?: number;
	}

	type Linkable = File | FS;

	/**
	 * This is an interface for a symbolic link.
	 * In unix file systems there are both symbolic and hard links. We do not
	 * have hard links here, but we need to highlight that nature of links here
	 * is symbolic. For example, when a target is deleted, symbolic link becomes
	 * broken. 
	 */
	interface SymLink {

		/**
		 * Flag that indicates if access to link's target is readonly (true), or
		 * can be writable (false value).
		 */
		readonly: boolean;

		/**
		 * Indicates with true value if target is a file
		 */
		isFile?: boolean;

		/**
		 * Indicates with true value if target is a folder
		 */
		isFolder?: boolean;

		target(): Promise<Linkable>;
	}

	type File = ReadonlyFile | ReadonlyVersionedFile |
		WritableFile | WritableVersionedFile;

	interface BaseFile {

		writable: boolean;

		versioned: boolean;

		/**
		 * Is a file name, given by the outside to this file. It may, or may not,
		 * be the same as an actual file name in the file system. It may also be
		 * null.
		 */
		name: string;

		/**
		 * Is a flag that says, whether file existed at the moment of this
		 * object's creation.
		 */
		isNew: boolean;

		/**
		 * This returns a promise, resolvable to file stats.
		 */
		stat(): Promise<FileStats>;

	}

	interface ReadonlyFile extends BaseFile {

		versioned: false;

		/**
		 * This returns a promise, resolvable to either non-empty byte array, or
		 * undefined.
		 * @param start optional parameter, setting a beginning of read. If
		 * missing, read will be done as if neither start, nor end parameters
		 * are given.
		 * @param end optional parameter, setting an end of read. If end is
		 * greater than file length, all available bytes are read. If parameter
		 * is missing, read will be done to file's end.
		 */
		readBytes(start?: number, end?: number): Promise<Uint8Array|undefined>;

		/**
		 * This returns a promise, resolvable to text, read from file, assuming
		 * utf8 encoding.
		 */
		readTxt(): Promise<string>;

		/**
		 * This returns a promise, resolvable to json, read from file
		 */
		readJSON<T>(): Promise<T>;

		/**
		 * This returns a promise, resolvable to bytes source with seek, which
		 * allows random reads.
		 */
		getByteSource(): Promise<web3n.ByteSource>;

	}

	interface WritableFile extends ReadonlyFile {
		
		/**
		 * This returns a promise, resolvable when file is written
		 * @param bytes is a complete file content to write
		 */
		writeBytes(bytes: Uint8Array): Promise<void>;

		/**
		 * This returns a promise, resolvable when file is written
		 * @param txt to write to file, using utf8 encoding
		 */
		writeTxt(txt: string): Promise<void>;

		/**
		 * This returns a promise, resolvable when file is written
		 * @param json
		 */
		writeJSON(json: any): Promise<void>;

		/**
		 * This returns a promise, resolvable to byte sink with seek
		 */
		getByteSink(): Promise<web3n.ByteSink>;

		/**
		 * This returns a promise, resolvable when copying is done.
		 * @param file which content will be copied into this file
		 */
		copy(file: File): Promise<void>;

	}

	interface ReadonlyVersionedFile extends BaseFile {

		versioned: true;

		/**
		 * This returns a promise, resolvable to either non-empty byte array, or
		 * undefined.
		 * @param start optional parameter, setting a beginning of read. If
		 * missing, read will be done as if neither start, nor end parameters
		 * are given.
		 * @param end optional parameter, setting an end of read. If end is
		 * greater than file length, all available bytes are read. If parameter
		 * is missing, read will be done to file's end.
		 */
		readBytes(start?: number, end?: number):
			Promise<{ bytes: Uint8Array|undefined; version: number; }>;

		/**
		 * This returns a promise, resolvable to text, read from file, assuming
		 * utf8 encoding.
		 */
		readTxt(): Promise<{ txt: string; version: number; }>;

		/**
		 * This returns a promise, resolvable to json, read from file
		 */
		readJSON<T>(): Promise<{ json: T; version: number; }>;

		/**
		 * This returns a promise, resolvable to bytes source with seek, which
		 * allows random reads, and a file version
		 */
		getByteSource(): Promise<{ src: web3n.ByteSource; version: number; }>;

	}

	interface WritableVersionedFile extends ReadonlyVersionedFile {
		
		/**
		 * This returns a promise, resolvable to new file's version when file is
		 * written
		 * @param bytes is a complete file content to write
		 */
		writeBytes(bytes: Uint8Array): Promise<number>;

		/**
		 * This returns a promise, resolvable to new file's version when file is
		 * written
		 * @param txt to write to file, using utf8 encoding
		 */
		writeTxt(txt: string): Promise<number>;

		/**
		 * This returns a promise, resolvable to new file's version when file is
		 * written
		 * @param json
		 */
		writeJSON(json: any): Promise<number>;

		/**
		 * This returns a promise, resolvable to byte sink with seek, and a file
		 * version
		 */
		getByteSink(): Promise<{ sink: web3n.ByteSink; version: number; }>;

		/**
		 * This returns a promise, resolvable to new file's version when copying
		 * is done.
		 * @param file which content will be copied into this file
		 */
		copy(file: File): Promise<number>;
		
	}

	type FSType = 'device' | 'synced' | 'local' | 'share' | 'asmail-msg';

	type FS = ReadonlyFS | ReadonlyVersionedFS |
		WritableFS | WritableVersionedFS;

	interface BaseFS {

		type: FSType;

		versioned: boolean;
		
		writable: boolean;

		/**
		 * Is a folder name, given by the outside to this file system. It may, or
		 * may not, be the same as an actual folder name. It may also be null.
		 */
		name: string;
		
		/**
		 * This returns a promise, resolvable to true, if folder exists, and to
		 * false, if folder is not found.
		 * @param path of a folder, which presence we want to check
		 * @param throwIfMissing is an optional flag, which forces with true value
		 * throwing of an exception, when folder does not exist. Default value is
		 * false.
		 */
		checkFolderPresence(path: string, throwIfMissing?: boolean):
			Promise<boolean>;
		
		/**
		 * This returns a promise, resolvable to true, if file exists, and to
		 * false, if file is not found.
		 * @param path of a file, which presence we want to check
		 * @param throwIfMissing is an optional flag, which forces with true value
		 * throwing of an exception, when file does not exist. Default value is
		 * false.
		 */
		checkFilePresence(path: string, throwIfMissing?: boolean):
			Promise<boolean>;
		
		/**
		 * This returns a promise, resolvable to true, if link exists, and to
		 * false, if link is not found.
		 * @param path of a link, which presence we want to check
		 * @param throwIfMissing is an optional flag, which forces with true value
		 * throwing of an exception, when link does not exist. Default value is
		 * false.
		 */
		checkLinkPresence(path: string, throwIfMissing?: boolean):
			Promise<boolean>;
		
		/**
		 * @param path of a file
		 * This returns a promise, resolvable to file stats.
		 */
		statFile(path: string): Promise<FileStats>;
		
		readLink(path: string): Promise<SymLink>;
		
		watchFolder(path: string, observer: Observer<FolderEvent>): () => void;

		close(): Promise<void>;

	}

	interface ReadonlyFS extends BaseFS {

		versioned: false;

		/**
		 * This returns a promise, resolvable to a file system object, rooted to a
		 * given folder.
		 * @param folder is a path of a root folder.
		 */
		readonlySubRoot(folder: string): Promise<ReadonlyFS>;
		
		/**
		 * This returns a promise, resolvable to a list of informational objects
		 * for entries in the folder.
		 * @param path of a folder that should be listed
		 */
		listFolder(folder: string): Promise<ListingEntry[]>;
		
		/**
		 * This returns a promise, resolvable to json, read from file
		 * @param path of a file from which to read json
		 */
		readJSONFile<T>(path: string): Promise<T>;
		
		/**
		 * This returns a promise, resolvable to text, read from file, assuming
		 * utf8 encoding.
		 * @param path of a file from which to read text
		 */
		readTxtFile(path: string): Promise<string>;
		
		/**
		 * This returns a promise, resolvable to either non-empty byte array, or
		 * undefined.
		 * @param path of a file from which to read bytes
		 * @param start optional parameter, setting a beginning of read. If
		 * missing, read will be done as if neither start, nor end parameters
		 * are given.
		 * @param end optional parameter, setting an end of read. If end is
		 * greater than file length, all available bytes are read. If parameter
		 * is missing, read will be done to file's end.
		 */
		readBytes(path: string, start?: number, end?: number):
			Promise<Uint8Array|undefined>;
		
		/**
		 * This returns a promise, resolvable to bytes source with seek, which
		 * allows random reads.
		 * @param path of a file from which to read bytes
		 */
		getByteSource(path: string): Promise<web3n.ByteSource>;

		/**
		 * This returns a promise, resolvable to readonly file object.
		 * @param path
		 */
		readonlyFile(path: string): Promise<ReadonlyFile>;

	}

	interface BaseWritableFS {
			
		/**
		 * This either finds existing, or creates new folder, asynchronously.
		 * @param path of a folder that should be created
		 * @param exclusive is an optional flag, which when set to true, throws
		 * if folder already exists. Default value is false, i.e. if folder
		 * exists, nothing happens.
		 */
		makeFolder(path: string, exclusive?: boolean): Promise<void>;
			
		/**
		 * This returns a promise, resolvable when folder has been removed
		 * @param path of a folder that should be removed
		 * @param removeContent is an optional flag, which true values forces
		 * recursive removal of all content in the folder. Default value is false.
		 * If folder is not empty, and content removal flag is not set, then an
		 * error is thrown.
		 */
		deleteFolder(path: string, removeContent?: boolean): Promise<void>;
		
		/**
		 * This returns a promise, resolvable when file has been removed
		 * @param path of a file that should be removed
		 */
		deleteFile(path: string): Promise<void>;
	
		/**
		 * This returns a promise, resolvable when file (or folder) has been
		 * moved.
		 * @param src is an initial path of a file (or folder)
		 * @param dst is a new path of a file (or folder)
		 */
		move(src: string, dst: string): Promise<void>;
	
		/**
		 * This returns a promise, resolvable when file has been copied.
		 * @param src is an initial path of a file
		 * @param dst is a path of a file
		 * @param overwrite is a flag that with a true value allows
		 * overwrite of existing dst file. Default value is false.
		 */
		copyFile(src: string, dst: string, overwrite?: boolean):
			Promise<void>;
		
		/**
		 * This returns a promise, resolvable when folder has been recursively
		 * copied.
		 * @param src is an initial path of a folder
		 * @param dst is a path of a folder
		 * @param mergeAndOverwrite is a flag that with true value allows
		 * merge into existing folder and files overwriting inside. Default
		 * value is false.
		 */
		copyFolder(src: string, dst: string, mergeAndOverwrite?: boolean):
			Promise<void>;
		
		/**
		 * This returns a promise, resolvable when file has been saved.
		 * @param file is a file to save
		 * @param dst is a path where to save given file
		 * @param overwrite is a flag that with a true value allows
		 * overwrite of existing dst file. Default value is false.
		 */
		saveFile(file: File, dst: string, overwrite?: boolean): Promise<void>;
		
		/**
		 * This returns a promise, resolvable when folder has been recursively
		 * saved.
		 * @param folder is a folder to save
		 * @param dst is a path where to save given folder
		 * @param mergeAndOverwrite is a flag that with true value allows
		 * merge into existing folder and files overwriting inside. Default
		 * value is false.
		 */
		saveFolder(folder: FS, dst: string, mergeAndOverwrite?: boolean):
			Promise<void>;

		/**
		 * This returns a promise, resolvable when file has been removed
		 * @param path of a link that should be removed
		 */
		deleteLink(path: string): Promise<void>;

		link(path: string, target: File | FS):
			Promise<void>;

	}

	interface WritableFS extends ReadonlyFS, BaseWritableFS {
		
		/**
		 * This returns a promise, resolvable to a file system object, rooted to a
		 * given folder.
		 * @param folder is a path of a root folder.
		 * @param create is a flag, which, with default value true, allows
		 * creation of sub-root folder, if it does not exist
		 * @param exclusive is a flag, that ensures exclusive creation of file
		 * with true value, while default value is false.
		 */
		writableSubRoot(folder: string, create?: boolean, exclusive?: boolean):
			Promise<WritableFS>;

		/**
		 * This returns a promise, resolvable when file is written
		 * @param path of a file to write given json
		 * @param json
		 * @param create is a flag, which, with default value true, allows
		 * creation of file, if it does not exist
		 * @param exclusive is a flag, which, with value true, throws up if file
		 * should be create and already exists. Default flag's value is false. 
		 */
		writeJSONFile(path: string, json: any, create?: boolean,
			exclusive?: boolean): Promise<void>;
		
		/**
		 * This returns a promise, resolvable when file is written
		 * @param path of a file to write given text
		 * @param txt to write to file, using utf8 encoding
		 * @param create is a flag, which, with default value true, allows
		 * creation of file, if it does not exist
		 * @param exclusive is a flag, which, with value true, throws up if file
		 * should be create and already exists. Default flag's value is false. 
		 */
		writeTxtFile(path: string, txt: string, create?: boolean,
			exclusive?: boolean): Promise<void>;
		
		/**
		 * This returns a promise, resolvable when file is written
		 * @param path of a file to write
		 * @param bytes to write to file. This is a whole of file content.
		 * @param create is a flag, which, with default value true, allows
		 * creation of file, if it does not exist
		 * @param exclusive is a flag, which, with value true, throws up if file
		 * should be create and already exists. Default flag's value is false. 
		 */
		writeBytes(path: string, bytes: Uint8Array, create?: boolean,
			exclusive?: boolean): Promise<void>;
		
		/**
		 * This returns a promise, resolvable to byte sink with seek
		 * @param path of a file for which we want to get a writable byte sink
		 * @param create is a flag, which, with default value true, allows
		 * creation of file, if it does not exist
		 * @param exclusive is a flag, that ensures exclusive creation of file
		 * with true value, while default value is false.
		 */
		getByteSink(path: string, create?: boolean, exclusive?: boolean):
			Promise<web3n.ByteSink>;

		/**
		 * This returns a promise, resolvable to file object.
		 * @param path
		 * @param create is a flag, which, with default value true, allows
		 * creation of file, if it does not exist
		 * @param exclusive is a flag, that ensures exclusive creation of file
		 * with true value, while default value is false.
		 */
		writableFile(path: string, create?: boolean, exclusive?: boolean):
			Promise<WritableFile>;
		
	}

	interface ReadonlyVersionedFS  extends BaseFS {

		versioned: true;

		/**
		 * This returns a promise, resolvable to a file system object, rooted to a
		 * given folder.
		 * @param folder is a path of a root folder.
		 */
		readonlySubRoot(folder: string): Promise<ReadonlyVersionedFS>;

		/**
		 * This returns a promise, resolvable to a list of informational objects
		 * for entries in the folder, and a folder's version.
		 * @param path of a folder that should be listed
		 */
		listFolder(path: string):
			Promise<{ lst: ListingEntry[]; version: number; }>;
		
		/**
		 * This returns a promise, resolvable to json, read from file, and a
		 * version of file.
		 * @param path of a file from which to read json
		 */
		readJSONFile<T>(path: string): Promise<{ json: T; version: number; }>;
		
		/**
		 * This returns a promise, resolvable to text, read from file, assuming
		 * utf8 encoding, and version of file.
		 * @param path of a file from which to read text
		 */
		readTxtFile(path: string): Promise<{ txt: string; version: number; }>;
		
		/**
		 * This returns a promise, resolvable to bytes, that is either non-empty
		 * byte array, or an undefined, and version of file.
		 * @param path of a file from which to read bytes
		 * @param start optional parameter, setting a beginning of read. If
		 * missing, read will be done as if neither start, nor end parameters
		 * are given.
		 * @param end optional parameter, setting an end of read. If end is
		 * greater than file length, all available bytes are read. If parameter
		 * is missing, read will be done to file's end.
		 */
		readBytes(path: string, start?: number, end?: number):
			Promise<{ bytes: Uint8Array|undefined; version: number; }>;
		
		/**
		 * This returns a promise, resolvable to bytes source with seek, which
		 * allows random reads, and a file version
		 * @param path of a file from which to read bytes
		 */
		getByteSource(path: string):
			Promise<{ src: web3n.ByteSource; version: number; }>;

		/**
		 * This returns a promise, resolvable to readonly file object.
		 * @param path
		 */
		readonlyFile(path: string): Promise<ReadonlyVersionedFile>;

	}

	interface WritableVersionedFS  extends ReadonlyVersionedFS, BaseWritableFS {
		
		/**
		 * This returns a promise, resolvable to a file system object, rooted to a
		 * given folder.
		 * @param folder is a path of a root folder.
		 * @param create is a flag, which, with default value true, allows
		 * creation of sub-root folder, if it does not exist
		 * @param exclusive is a flag, that ensures exclusive creation of file
		 * with true value, while default value is false.
		 */
		writableSubRoot(folder: string, create?: boolean, exclusive?: boolean):
			Promise<WritableVersionedFS>;

		/**
		 * This returns a promise, resolvable to new file's version when file is
		 * written.
		 * @param path of a file to write given json
		 * @param json
		 * @param create is a flag, which, with default value true, allows
		 * creation of file, if it does not exist
		 * @param exclusive is a flag, which, with value true, throws up if file
		 * should be create and already exists. Default flag's value is false. 
		 */
		writeJSONFile(path: string, json: any, create?: boolean,
			exclusive?: boolean): Promise<number>;
		
		/**
		 * This returns a promise, resolvable to new file's version when file is
		 * written
		 * @param path of a file to write given text
		 * @param txt to write to file, using utf8 encoding
		 * @param create is a flag, which, with default value true, allows
		 * creation of file, if it does not exist
		 * @param exclusive is a flag, which, with value true, throws up if file
		 * should be create and already exists. Default flag's value is false. 
		 */
		writeTxtFile(path: string, txt: string, create?: boolean,
			exclusive?: boolean): Promise<number>;
		
		/**
		 * This returns a promise, resolvable to new file's version when file is
		 * written
		 * @param path of a file to write
		 * @param bytes to write to file. This is a whole of file content.
		 * @param create is a flag, which, with default value true, allows
		 * creation of file, if it does not exist
		 * @param exclusive is a flag, which, with value true, throws up if file
		 * should be create and already exists. Default flag's value is false. 
		 */
		writeBytes(path: string, bytes: Uint8Array, create?: boolean,
			exclusive?: boolean): Promise<number>;
		
		/**
		 * This returns a promise, resolvable to byte sink with seek, and a file
		 * version
		 * @param path of a file for which we want to get a writable byte sink
		 * @param create is a flag, which, with default value true, allows
		 * creation of file, if it does not exist
		 * @param exclusive is a flag, that ensures exclusive creation of file
		 * with true value, while default value is false.
		 */
		getByteSink(path: string, create?: boolean, exclusive?: boolean):
			Promise<{ sink: web3n.ByteSink; version: number; }>;

		/**
		 * This returns a promise, resolvable to file object.
		 * @param path
		 * @param create is a flag, which, with default value true, allows
		 * creation of file, if it does not exist
		 * @param exclusive is a flag, that ensures exclusive creation of file
		 * with true value, while default value is false.
		 */
		writableFile(path: string, create?: boolean, exclusive?: boolean):
			Promise<WritableVersionedFile>;
		
		tryUnblock(path: string, exc: FileException): Promise<number>;

	}

	interface FSEvent {
		type: string;
	}

	type FolderEvent = EntryRemovalEvent | EntryAdditionEvent;

	interface EntryRemovalEvent extends FSEvent {
		type: 'entry-removal';
		name: string;
	}

	interface EntryAdditionEvent extends FSEvent {
		type: 'entry-addition';
		entry: ListingEntry;
	}

}

declare namespace web3n.ipc {

	interface Duplex {
		
		/**
		 * This functionality actually does sending/receiving of message
		 * envelopes of this duplex.
		 */
		raw: RawDuplex<Envelope>;

		/**
		 * This function creates a more convenient functionality for this side to
		 * act as a client, viewing/using other side as a server.
		 * Note that communication still goes through this duplex's raw duplex.
		 */
		makeClient(channel: string): SubscribingClient;

		/**
		 * This function creates a more convenient functionality for this side to
		 * act as a server, viewing/serving other side as a client.
		 * Note that communication still goes through this duplex's raw duplex.
		 */
		makeServer(channel: string): EventfulServer;
	}

	interface RawDuplex<T> {

		/**
		 * This function triggers sending of a given message to the other side.
		 * Implementation may throw an error, if duplex is already disconnected.
		 * @param m
		 */
		postMessage(m: T): void;

		/**
		 * This function subscribes given observer to receive message that come
		 * from the other side.
		 * @param observer
		 */
		subscribe(observer: Observer<T>): () => void;
	}

	interface RequestEnvelope<T> {
		type: 'request';
		name: string;
		count: number;
		req: T;
	}

	interface ReplyEnvelope<T> {
		type: 'reply';
		reqName: string;
		reqCount: number;
		isInProgress?: boolean;
		rep: T|null;
		err?: any;
	}

	interface EventEnvelope<T> {
		type: 'event';
		channel: string;
		event: T;
	}

	interface EventEndEnvelope {
		type: 'event-end';
		channel: string;
		err?: any;
	}

	type Envelope = RequestEnvelope<any> | ReplyEnvelope<any> |
		EventEnvelope<any> | EventEndEnvelope;
		
	interface EventException extends web3n.RuntimeException {
		type: 'events';
		unknownEvent?: true;
		channel?: string;
	}

	interface RequestServer extends Closable {
		
		/**
		 * @param reqName is a name of request, to be handled by a given handler
		 * @param handler handles requests that come from the other side
		 */
		addHandler(reqName: string, handler: RequestHandler<any, any>): void;

		/**
		 * This method sends a notification of a progress on a given request.
		 * @param env is a request to which notification should be maid
		 * @param rep is a notification object
		 */
		notifyOfProgressOnRequest<T>(env: RequestEnvelope<any>, rep: T): void;

	}

	type RequestHandler<TReq, TRes> =
		(env: RequestEnvelope<TReq>) => Promise<TRes>|void;
	
	interface RequestingClient extends Closable {

		/**
		 * This returns a promise, resolvable to a reply that other side sends back,
		 * when it completes a request.
		 * This is a generic method with type T being a type of a final reply.
		 * @param reqName is a name of this request, sort of like a function name
		 * @param req is a request object that is sent to worker in the message
		 */
		makeRequest<T>(reqName: string, req: any,
				notifyCallback?: (progress: any) => void): Promise<T>;

	}

	/**
	 * Eventful server is a side of an ipc channel. As a request server, it serves
	 * requests that come from another side of an ipc channel. This server also
	 * sends events to another side, but only if the other side subscribed to a
	 * particular event channels.
	 */
	interface EventfulServer extends RequestServer {

		/**
		 * This function adds available event group. For some events event group is
		 * exactly the same as an event channel. For other events group is a prefix
		 * for an actual event.
		 * @param eventGroup is either a complete event channel, or a prefix
		 * that defines events' group
		 * @param subscriptionHandler is an async function that checks if a given
		 * event channel can be subscribed to. If subscription cannot be done, an
		 * error should be thrown with respective reason.
		 * @param unsubscriptionHandler is a function, if given, is called when
		 * last consumer is unsubscribed from a given group of events.
		 */
		addEventGroup(eventGroup: string,
			subscriptionHandler: (eventChannel: string) => Promise<void>|void,
			unsubscriptionHandler?: (eventChannel: string) => void): void;

		/**
		 * This function sends an event, if another side have subscribed to it, else
		 * it is a noop.
		 * @param channel
		 * @param event
		 */
		sendEvent<T>(channel: string, event: T): void;

		/**
		 * This function sends an event end notification, unsubscribing the other
		 * side from a given event channel.
		 * @param channel
		 * @param err is should be given to make it a completion on error
		 */
		endEvent(channel: string, err?: any): void;

	}

	/**
	 * Subscribing client is a side of an ipc channel. As a requesting client, it
	 * makes request-reply style calls to the other side of the ipc channel.
	 * Subscribing functionality allows to subscribe to particular event channels,
	 * for events coming from the other side.
	 */
	interface SubscribingClient extends RequestingClient {

		/**
		 * This function subscribes given in observer callbacks to an event channel,
		 * returning a function that detaches the observer, when called.
		 * Due to immediate subscription, given in observer callbacks become hot.
		 * @param channel
		 * @param observer is an object with at least one of three methods: next,
		 * completed, and error.
		 * Method next it is an on-event callback, called every time there is an
		 * event, which can be zero or more times. This is never called after either
		 * completion, error, or detachment.
		 * Method completed is a callback that is called only once, when event
		 * source says that there will be no more events, i.e. when a normal
		 * completion occurs. Note that this function is not called when detacher
		 * is triggered.
		 * Method error is a callback that is called on error, either coming from
		 * event source, or if onNext throws something, although it must handle its
		 * own stuff.
		 */
		subscribe<T>(channel: string, observer: Observer<T>): () => void;

	}

	interface Closable {

		close(): void;

		on(event: 'end', cb: (err?: any) => void): void;

	}

}
