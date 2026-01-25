/**
 * GENERATED CODE - DO NOT MODIFY
 */
import { type BlobRef } from '@atproto/lexicon'
import { validate as _validate } from '../../../../lexicons.js'
import {
  is$typed as _is$typed,
} from '../../../../util.js'

/** A reference to a specific version of a record (AT Protocol strong ref). */
interface StrongRef {
  uri: string
  cid: string
}


const is$typed = _is$typed,
  validate = _validate
const id = 'org.rwell.test.like'

export interface Main {
  $type: 'org.rwell.test.like'
  subject: StrongRef
  /** Timestamp when this like was created. */
  createdAt: string
  [k: string]: unknown
}

const hashMain = 'main'

export function isMain<V>(v: V) {
  return is$typed(v, id, hashMain)
}

export function validateMain<V>(v: V) {
  return validate<Main & V>(v, id, hashMain, true)
}

export {
  type Main as Record,
  isMain as isRecord,
  validateMain as validateRecord,
}
