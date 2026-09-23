import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
    adToBs,
    addBsMonths,
    getBsMonthDays,
    getBsMonthName,
    getBsMonthStartWeekday,
} from '@/lib/nepaliDate'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import dayjs from 'dayjs'
import _ from '@/lib/translate'

type BSCalendarRangeProps = {
    fromDate?: string
    toDate?: string
    onSelect: (fromDate: string, toDate: string) => void
}

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

const BSMonthGrid = ({
    year,
    month,
    fromDate,
    toDate,
    hoverDate,
    onDayClick,
    onDayHover,
}: {
    year: number
    month: number
    fromDate?: string
    toDate?: string
    hoverDate?: string
    onDayClick: (ad: string) => void
    onDayHover: (ad: string) => void
}) => {
    const days = useMemo(() => getBsMonthDays(year, month), [year, month])
    const startWeekday = useMemo(() => getBsMonthStartWeekday(year, month), [year, month])

    const rangeEnd = toDate || hoverDate

    const inRange = (ad: string) => {
        if (!fromDate || !rangeEnd) return false
        const a = fromDate <= rangeEnd ? fromDate : rangeEnd
        const b = fromDate <= rangeEnd ? rangeEnd : fromDate
        return ad >= a && ad <= b
    }

    const isEndpoint = (ad: string) => ad === fromDate || ad === toDate

    return (
        <div className="w-[240px] p-2">
            <div className="text-sm font-medium text-center mb-2">
                {getBsMonthName(month)} {year}
            </div>
            <div className="grid grid-cols-7 gap-0.5 mb-1">
                {WEEKDAYS.map((d) => (
                    <div key={d} className="text-[10px] text-muted-foreground text-center py-1">{d}</div>
                ))}
            </div>
            <div className="grid grid-cols-7 gap-0.5">
                {Array.from({ length: startWeekday }).map((_, i) => (
                    <div key={`e-${i}`} />
                ))}
                {days.map((day) => {
                    const selected = isEndpoint(day.ad)
                    const ranged = inRange(day.ad)
                    return (
                        <button
                            key={day.bs}
                            type="button"
                            className={cn(
                                'h-8 w-8 text-xs rounded-md flex flex-col items-center justify-center leading-none',
                                ranged && !selected && 'bg-accent',
                                selected && 'bg-primary text-primary-foreground',
                                !selected && 'hover:bg-accent'
                            )}
                            onClick={() => onDayClick(day.ad)}
                            onMouseEnter={() => onDayHover(day.ad)}
                            title={`BS ${day.bs} · AD ${day.ad}`}
                        >
                            <span>{day.bsDay}</span>
                            <span className={cn('text-[8px]', selected ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
                                {dayjs(day.ad).format('D')}
                            </span>
                        </button>
                    )
                })}
            </div>
        </div>
    )
}

/**
 * Nepali (BS) month calendar for selecting an AD-stored date range.
 * Each cell shows the BS day with the AD day number underneath.
 */
const BSCalendarRange = ({ fromDate, toDate, onSelect }: BSCalendarRangeProps) => {
    const initial = adToBs(fromDate || new Date()) || { year: 2082, month: 4, day: 1 }
    const [view, setView] = useState({ year: initial.year, month: initial.month })
    const [pickingFrom, setPickingFrom] = useState(!fromDate || !!toDate)
    const [draftFrom, setDraftFrom] = useState<string | undefined>(fromDate)
    const [draftTo, setDraftTo] = useState<string | undefined>(toDate)
    const [hoverDate, setHoverDate] = useState<string | undefined>()

    const nextMonth = addBsMonths(view.year, view.month, 1)

    const onDayClick = (ad: string) => {
        if (pickingFrom || !draftFrom) {
            setDraftFrom(ad)
            setDraftTo(undefined)
            setPickingFrom(false)
            return
        }

        let from = draftFrom
        let to = ad
        if (to < from) {
            from = ad
            to = draftFrom
        }
        setDraftFrom(from)
        setDraftTo(to)
        setPickingFrom(true)
        onSelect(from, to)
    }

    return (
        <div className="flex flex-col">
            <div className="px-3 py-2 text-xs text-muted-foreground border-b flex items-center justify-between gap-2">
                <span>{_("BS calendar — AD day shown under each date")}</span>
                <div className="flex items-center gap-1">
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setView(addBsMonths(view.year, view.month, -1))}
                    >
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setView(addBsMonths(view.year, view.month, 1))}
                    >
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                </div>
            </div>
            <div className="flex">
                <BSMonthGrid
                    year={view.year}
                    month={view.month}
                    fromDate={draftFrom}
                    toDate={draftTo}
                    hoverDate={!draftTo ? hoverDate : undefined}
                    onDayClick={onDayClick}
                    onDayHover={setHoverDate}
                />
                <BSMonthGrid
                    year={nextMonth.year}
                    month={nextMonth.month}
                    fromDate={draftFrom}
                    toDate={draftTo}
                    hoverDate={!draftTo ? hoverDate : undefined}
                    onDayClick={onDayClick}
                    onDayHover={setHoverDate}
                />
            </div>
        </div>
    )
}

export default BSCalendarRange
