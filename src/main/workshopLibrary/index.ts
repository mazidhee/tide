/**
 * The library of guided projects (shared/workshop.ts has the format). Every project here is proved
 * by test/workshopLibrary.test.ts: its reference solution passes every test of every stage in the
 * sandbox, and its starting files fail in every stage. Main process only: the tests and the
 * solutions never reach the renderer.
 */
import type { WorkshopProject } from '@shared/workshop'
import { bpeTokeniser } from './bpeTokeniser'
import { hashRing } from './hashRing'
import { jsonParser } from './jsonParser'
import { kvWal } from './kvWal'
import { ledger } from './ledger'
import { lruCache } from './lruCache'
import { neuralNet } from './neuralNet'
import { raft } from './raft'
import { rateLimiter } from './rateLimiter'
import { routePlanner } from './routePlanner'
import { salesReport } from './salesReport'
import { shell } from './shell'

export const LIBRARY: WorkshopProject[] = [kvWal, shell, rateLimiter, jsonParser, lruCache, raft, hashRing, ledger, salesReport, bpeTokeniser, neuralNet, routePlanner]
