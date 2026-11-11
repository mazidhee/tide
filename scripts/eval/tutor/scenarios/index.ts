/** Every scenario, in a fixed order: by subject, and within a subject by situation */
import type { Scenario } from '../types'
import { BREADTH_HUMANITIES } from './breadth-humanities'
import { BREADTH_PRACTICE } from './breadth-practice'
import { BREADTH_SCIENCES } from './breadth-sciences'
import { CCPP } from './c-cpp'
import { DATA_ENG } from './data-eng'
import { DATABASES } from './databases'
import { DISTRIBUTED } from './distributed'
import { MATHS } from './maths'
import { ML } from './ml'
import { SYSTEMS } from './systems'
import { HUMANITIES } from './humanities'

export const SCENARIOS: Scenario[] = [...SYSTEMS, ...CCPP, ...DISTRIBUTED, ...DATABASES, ...ML, ...MATHS, ...DATA_ENG, ...BREADTH_SCIENCES, ...BREADTH_PRACTICE, ...BREADTH_HUMANITIES, ...HUMANITIES]
