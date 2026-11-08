/**
 * Spots explicit memory requests in a message ("remember that…", "forget that…"), so they're saved
 * whether or not the model calls its memory tool. Only clear phrasings count: "I don't remember
 * how heaps work" is not a request.
 */
export function memoryIntent(text: string): { remember: string[]; forget: string[] } {
  const remember: string[] = []
  const forget: string[] = []
  const grab = (re: RegExp, into: string[]) => {
    for (const m of text.matchAll(re)) {
      const fact = m[1].replace(/\s+/g, ' ').trim().replace(/[,;:]$/, '')
      if (fact.length >= 4 && fact.split(' ').length <= 40) into.push(fact.charAt(0).toUpperCase() + fact.slice(1))
    }
  }
  grab(/(?:^|[.!?]\s+|\n)\s*(?:(?:please|also|and|ok(?:ay)?|so)[, ]+)*(?:can you |could you |would you )?(?:remember|keep in mind|don'?t forget|note)(?: this)?(?: that|:)\s*([^\n.!?]+(?:\.\d[^\n.!?]*)*)/gi, remember)
  grab(/(?:^|[.!?]\s+|\n)\s*(?:(?:please|also|and|ok(?:ay)?|so)[, ]+)*(?:can you |could you )?forget(?: about)?(?: that|:)\s*([^\n.!?]+)/gi, forget)
  return { remember, forget }
}
