import { formatAlternateDate, formatCalendarDate, calendarModeAtom } from '@/lib/nepaliDate'
import { cn } from '@/lib/utils'
import { useAtomValue } from 'jotai'

type DualDateProps = {
    /** AD date string (YYYY-MM-DD) as stored in ERPNext */
    date?: string | Date | null
    format?: string
    className?: string
    primaryClassName?: string
    alternateClassName?: string
}

/**
 * Shows the date in the active calendar (BS or AD) with the other calendar
 * in a smaller muted label for quick reference.
 */
const DualDate = ({ date, format, className, primaryClassName, alternateClassName }: DualDateProps) => {
    const mode = useAtomValue(calendarModeAtom)
    if (!date) return null

    const primary = formatCalendarDate(date, format)
    const alternate = formatAlternateDate(date)
    const alternateLabel = mode === 'BS' ? 'AD' : 'BS'

    if (!alternate || alternate === primary) {
        return <span className={cn('font-semibold text-sm', primaryClassName, className)}>{primary}</span>
    }

    return (
        <span className={cn('inline-flex items-baseline gap-1.5', className)}>
            <span className={cn('font-semibold text-sm', primaryClassName)}>{primary}</span>
            <span className={cn('text-[11px] text-muted-foreground font-mono', alternateClassName)}>
                {alternateLabel} {alternate}
            </span>
        </span>
    )
}

export default DualDate
