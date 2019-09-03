import {
  NoteStorageDocMap,
  FolderData,
  FolderDataEditibleProps,
  TagDataEditibleProps,
  TagData,
  NoteData,
  NoteDataEditibleProps
} from './types'
import {
  getFolderId,
  createUnprocessableEntityError,
  isFolderPathnameValid,
  getParentFolderPathname,
  getTagId,
  isTagNameValid,
  generateNoteId,
  getNow,
  createNotFoundError
} from './utils'
import { Except } from 'type-fest'

export default class Client {
  public initialized: boolean

  constructor(
    public db: PouchDB.Database,
    public id: string,
    public name: string
  ) {}

  // WIP
  async init() {
    await this.upsertNoteListViews()
    // Check root directory does exist
    await this.upsertFolder('/')
    // Load all docs and classify into maps(noteMap, folderMap, tagMap)
    // const {noteMap, folderMap, tagMap} = await this.getAllDataMap()
    // Check all note(except trashed)
    // - Check folder does exist
    // - Check its parent folder does exist
    // - Check tag does exist
    // Check pathname of all folders
    // Generate missing folders and tags at once.
    // Done.
  }

  async getFolder(path: string): Promise<FolderData | null> {
    return this.getDoc<FolderData>(getFolderId(path))
  }

  async upsertFolder(
    pathname: string,
    props?: Partial<FolderDataEditibleProps>
  ): Promise<FolderData> {
    if (!isFolderPathnameValid(pathname)) {
      throw createUnprocessableEntityError(
        `pathname is invalid, got \`${pathname}\``
      )
    }
    if (pathname !== '/') {
      await this.doesParentFolderExistOrCreate(pathname)
    }
    const folder = await this.getFolder(pathname)
    if (folder != null && props == null) {
      return folder
    }
    const now = getNow()
    const folderDocProps = {
      ...(folder || {
        _id: getFolderId(pathname),
        createdAt: now,
        data: {}
      }),
      ...props,
      updatedAt: now
    }
    const { rev } = await this.db.put(folderDocProps)

    return {
      _id: folderDocProps._id,
      createdAt: folderDocProps.createdAt,
      updatedAt: folderDocProps.updatedAt,
      data: folderDocProps.data,
      _rev: rev
    }
  }

  async doesParentFolderExistOrCreate(pathname: string) {
    const parentPathname = getParentFolderPathname(pathname)
    await this.upsertFolder(parentPathname)
  }

  async getAllDataMap(): Promise<NoteStorageDocMap> {
    const map = {
      noteMap: new Map(),
      folderMap: new Map(),
      tagMap: new Map()
    }
    const allDocsResponse = await this.db.allDocs({})

    return allDocsResponse.rows.reduce((map, doc) => {
      doc
      return map
    }, map)
  }

  async getTag(tagName: string): Promise<TagData | null> {
    return this.getDoc<TagData>(getTagId(tagName))
  }

  async getDoc<T extends PouchDB.Core.GetMeta & PouchDB.Core.IdMeta>(
    docId: string
  ): Promise<T | null> {
    try {
      return await this.db.get<T>(docId)
    } catch (error) {
      switch (error.name) {
        case 'not_found':
          return null
        default:
          throw error
      }
    }
  }

  async upsertTag(tagName: string, props?: Partial<TagDataEditibleProps>) {
    if (!isTagNameValid(tagName)) {
      throw createUnprocessableEntityError(
        `tag name is invalid, got \`${tagName}\``
      )
    }

    const tag = await this.getTag(tagName)
    if (tag != null && props == null) {
      return tag
    }

    const now = getNow()
    const tagDocProps = {
      ...(tag || {
        _id: getTagId(tagName),
        createdAt: now,
        data: {}
      }),
      ...props,
      updatedAt: now
    }
    const { rev } = await this.db.put(tagDocProps)

    return {
      _id: tagDocProps._id,
      createdAt: tagDocProps.createdAt,
      updatedAt: tagDocProps.updatedAt,
      data: tagDocProps.data,
      _rev: rev
    }
  }

  async getNote(noteId: string): Promise<NoteData | null> {
    return this.getDoc<NoteData>(noteId)
  }

  async createNote(
    noteProps: Partial<NoteDataEditibleProps> = {}
  ): Promise<NoteData> {
    const now = getNow()
    const noteDocProps: Except<NoteData, '_rev'> = {
      _id: generateNoteId(),
      title: 'Untitled',
      content: '',
      tags: [],
      folderPathname: '/',
      data: {},
      ...noteProps,
      createdAt: now,
      updatedAt: now,
      trashed: false
    }

    await this.upsertFolder(noteDocProps.folderPathname)
    await Promise.all(noteDocProps.tags.map(tagName => this.upsertTag(tagName)))

    const { rev } = await this.db.put(noteDocProps)

    return {
      ...noteDocProps,
      _rev: rev
    }
  }

  async updateNote(noteId: string, noteProps: Partial<NoteDataEditibleProps>) {
    const note = await this.getNote(noteId)
    if (note == null)
      throw createNotFoundError(`The note \`${noteId}\` does not exist`)

    if (noteProps.folderPathname) {
      await this.upsertFolder(noteProps.folderPathname)
    }
    if (noteProps.tags) {
      await Promise.all(noteProps.tags.map(tagName => this.upsertTag(tagName)))
    }

    const now = getNow()
    const noteDocProps = {
      ...note,
      ...noteProps,
      updatedAt: now
    }
    const { rev } = await this.db.put<NoteData>(noteDocProps)

    return {
      ...noteDocProps,
      _rev: rev
    }
  }

  async findNotesByFolder(folderPathname: string): Promise<NoteData[]> {
    const { rows } = await this.db.query<NoteData>('notes/by_folder', {
      key: folderPathname,
      include_docs: true
    })

    return rows.map(row => row.doc!)
  }

  async findNotesByTag(tagName: string): Promise<NoteData[]> {
    const { rows } = await this.db.query<NoteData>('notes/by_tag', {
      key: tagName,
      include_docs: true
    })

    return rows.map(row => row.doc!)
  }

  async upsertNoteListViews() {
    const ddoc = await this.getDoc<
      {
        views: { [key: string]: { map: string } }
      } & PouchDB.Core.GetMeta &
        PouchDB.Core.IdMeta
    >('_design/notes')
    const byFolderMap = `function(doc) {
      if (doc._id.startsWith('note:')) {
        emit(doc.folderPathname)
      }
    }`
    const byTagMap = `function(doc) {
      if (doc._id.startsWith('note:')) {
        doc.tags.forEach(tag => emit(tag))
      }
    }`
    if (ddoc != null) {
      if (
        ddoc.views.by_folder.map === byFolderMap &&
        ddoc.views.by_tag.map === byTagMap
      ) {
        return ddoc
      }
    }

    return this.db.put({
      ...(ddoc || {
        _id: '_design/notes'
      }),
      views: {
        by_folder: {
          map: byFolderMap
        },
        by_tag: {
          map: byTagMap
        }
      }
    })
  }

  async trashNote(noteId: string): Promise<NoteData> {
    const note = await this.getNote(noteId)
    if (note == null)
      throw createNotFoundError(`The note \`${noteId}\` does not exist`)

    const noteDocProps = {
      ...note,
      trashed: true
    }
    const { rev } = await this.db.put<NoteData>(noteDocProps)

    return {
      ...noteDocProps,
      _rev: rev
    }
  }

  async untrashNote(noteId: string): Promise<NoteData> {
    const note = await this.getNote(noteId)
    if (note == null)
      throw createNotFoundError(`The note \`${noteId}\` does not exist`)

    const noteDocProps = {
      ...note,
      trashed: false
    }
    const { rev } = await this.db.put<NoteData>(noteDocProps)

    return {
      ...noteDocProps,
      _rev: rev
    }
  }

  async purgeNote(noteId: string): Promise<void> {
    const note = await this.getNote(noteId)
    if (note == null)
      throw createNotFoundError(`The note \`${noteId}\` does not exist`)

    await this.db.remove(note)
  }

  /**
   * WIP
   *
   * removeTag
   * removeFolder
   * trashNotesInFolder
   */
}
