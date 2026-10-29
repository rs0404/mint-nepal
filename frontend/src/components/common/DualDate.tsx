import { formatAlternateDate, formatCalendarDate, calendarModeAtom } from '@/lib/nepaliDate'
import _ from '@/lib/translate'
import { cn } from '@/lib/utils'
import dayjs from 'dayjs'
import { useAtomValue } from 'jotai'

type DualDateProps = {
    /** AD date string (YYYY-MM-DD) as stored in ERPNext */
    date?: string | Date | null
    format?: string
    className?: string
    primaryClassName?: string
    alternateClassName?: string
    /** Show the weekday and how many days ago the date was. Defaults to true. */
    showAge?: boolean
    /** Put the date, the other calendar and the age on separate lines, for narrow table columns. */
    stacked?: boolean
}

/** Whole calendar days between the date and today: "Today", "3 days ago", "in 2 days". */
const getDaysAgo = (date: string | Date) => {
    const days = dayjs().startOf('day').diff(dayjs(date).startOf('day'), 'day')
    if (days === 0) return _('Today')
    if (days === 1) return _('Yesterday')
    if (days === -1) return _('Tomorrow')
    if (days > 0) return _('{0} days ago', [String(days)])
    return _('in {0} days', [String(-days)])
}

/**
 * Shows the date in the active calendar (BS or AD) with the other calendar
 * in a smaller muted label for quick reference.
 */
const DualDate = ({ date, format, className, primaryClassName, alternateClassName, showAge = true, stacked = false }: DualDateProps) => {
    const mode = useAtomValue(calendarModeAtom)
    if (!date) return null

    const primary = formatCalendarDate(date, format)
    const alternate = formatAlternateDate(date)
    const alternateLabel = mode === 'BS' ? 'AD' : 'BS'
    const showAlternate = !!alternate && alternate !== primary

    if (!showAlternate && !showAge) {
        return <span className={cn('font-semibold text-sm', primaryClassName, className)}>{primary}</span>
    }

    return (
        <span className={cn(stacked ? 'inline-flex flex-col leading-tight' : 'inline-flex items-baseline gap-1.5', className)}>
            <span className={cn('font-semibold text-sm', primaryClassName)}>{primary}</span>
            {showAlternate && <span className={cn('text-[11px] text-muted-foreground font-mono', alternateClassName)}>
                {alternateLabel} {alternate}
            </span>}
            {showAge && <span className='text-[11px] text-muted-foreground whitespace-nowrap' title={dayjs(date).format('dddd')}>
                {dayjs(date).format('ddd')} · {getDaysAgo(date)}
            </span>}
        </span>
    )
}

export default DualDate
