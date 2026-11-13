/**
 * The ready roadmaps' text (resources/roadmaps, listed in shared/finance/roadmaps), bundled with
 * the app so they work offline and without any model.
 */
import { readyRoadmap } from '@shared/finance/roadmaps'
import PAYMENTS from '../../../resources/roadmaps/RM_PAYMENTS.md?raw'
import PAYMENT_INFRASTRUCTURE from '../../../resources/roadmaps/RM_PAYMENT_INFRASTRUCTURE.md?raw'
import CORE_BANKING from '../../../resources/roadmaps/RM_CORE_BANKING.md?raw'
import OPEN_BANKING from '../../../resources/roadmaps/RM_OPEN_BANKING.md?raw'
import STABLECOINS from '../../../resources/roadmaps/RM_STABLECOINS.md?raw'
import BLOCKCHAIN from '../../../resources/roadmaps/RM_BLOCKCHAIN.md?raw'
import QUANT_FINANCE from '../../../resources/roadmaps/RM_QUANT_FINANCE.md?raw'
import RISK from '../../../resources/roadmaps/RM_RISK.md?raw'
import MACHINE_LEARNING from '../../../resources/roadmaps/RM_MACHINE_LEARNING.md?raw'
import DATA_ENGINEERING from '../../../resources/roadmaps/RM_DATA_ENGINEERING.md?raw'
import DATA_SCIENCE from '../../../resources/roadmaps/RM_DATA_SCIENCE.md?raw'
import ECONOMICS from '../../../resources/roadmaps/RM_ECONOMICS.md?raw'
import CPP from '../../../resources/roadmaps/RM_CPP.md?raw'
import BACKEND from '../../../resources/roadmaps/RM_BACKEND.md?raw'
import BIG_DATA from '../../../resources/roadmaps/RM_BIG_DATA.md?raw'
import BLOCKCHAIN_ENGINEERING from '../../../resources/roadmaps/RM_BLOCKCHAIN_ENGINEERING.md?raw'
import MLE from '../../../resources/roadmaps/RM_MLE.md?raw'

export const ROADMAP_TEXT: Record<string, string> = {
  'RM_PAYMENTS.md': PAYMENTS,
  'RM_PAYMENT_INFRASTRUCTURE.md': PAYMENT_INFRASTRUCTURE,
  'RM_CORE_BANKING.md': CORE_BANKING,
  'RM_OPEN_BANKING.md': OPEN_BANKING,
  'RM_STABLECOINS.md': STABLECOINS,
  'RM_BLOCKCHAIN.md': BLOCKCHAIN,
  'RM_QUANT_FINANCE.md': QUANT_FINANCE,
  'RM_RISK.md': RISK,
  'RM_MACHINE_LEARNING.md': MACHINE_LEARNING,
  'RM_DATA_ENGINEERING.md': DATA_ENGINEERING,
  'RM_DATA_SCIENCE.md': DATA_SCIENCE,
  'RM_ECONOMICS.md': ECONOMICS,
  'RM_CPP.md': CPP,
  'RM_BACKEND.md': BACKEND,
  'RM_BIG_DATA.md': BIG_DATA,
  'RM_BLOCKCHAIN_ENGINEERING.md': BLOCKCHAIN_ENGINEERING,
  'RM_MLE.md': MLE
}

/** A ready roadmap's Markdown, by its id */
export function readyRoadmapText(id: string): string {
  const r = readyRoadmap(id)
  const text = r ? ROADMAP_TEXT[r.file] : undefined
  if (!text) throw new Error(`There is no ready roadmap called ${id}`)
  return text
}
