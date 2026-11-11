import { useMemo } from "react"

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Renders text with every exact (case-insensitive) occurrence of the search term marked.
 * Searches are fuzzy, so this makes the rows that really contain the term easy to spot.
 */
const HighlightMatch = ({ text, search }: { text?: string | null, search?: string }) => {

    const parts = useMemo(() => {
        const term = search?.trim()
        if (!text || !term) {
            return null
        }
        // A capture group keeps the matched pieces in the split output, at the odd indexes
        return text.split(new RegExp(`(${escapeRegExp(term)})`, 'gi'))
    }, [text, search])

    if (!parts || parts.length === 1) {
        return <>{text}</>
    }

    return <>
        {parts.map((part, index) => index % 2 === 1 ?
            <mark key={index} className="bg-yellow-200 dark:bg-yellow-500/40 text-inherit rounded-xs">{part}</mark> :
            part
        )}
    </>
}

export default HighlightMatch
