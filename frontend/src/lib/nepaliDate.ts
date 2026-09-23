import { atomWithStorage } from 'jotai/utils'
import { getDefaultStore } from 'jotai'
import dayjs from 'dayjs'

export type CalendarMode = 'BS' | 'AD'

/** Persisted preference: BS is the default for Nepal. */
export const calendarModeAtom = atomWithStorage<CalendarMode>('mint-calendar-mode', 'BS')

export const getCalendarMode = (): CalendarMode => {
    try {
        return getDefaultStore().get(calendarModeAtom) ?? 'BS'
    } catch {
        return 'BS'
    }
}

export type BsParts = {
    year: number
    month: number
    day: number
}

declare global {
    interface Window {
        NepaliDateLib?: {
            adToBs: (date: Date) => { year: number; monthIndex: number; day: number }
            bsToAd: (year: number, monthIndex: number, day: number) => Date
            MONTH_NAMES_EN_BS: string[]
            getDaysInMonth?: (year: number, monthIndex: number) => number
            getMonthLength?: (year: number, monthIndex: number) => number
            formatDateBS: (bs: { year: number; monthIndex: number; day: number }, format?: string, locale?: string) => string
            NepaliDate: new (...args: unknown[]) => {
                year: number
                monthIndex: number
                day: number
                toAD: () => Date
                format: (opts?: { format?: string; calendar?: string; locale?: string }) => string
            }
        }
        NepaliCalendarLib?: {
            render: (el: HTMLElement, props: Record<string, unknown>) => void
            unmount: (el: HTMLElement) => void
        }
    }
}

const hasNepaliLib = () => typeof window !== 'undefined' && !!window.NepaliDateLib

/** Convert AD YYYY-MM-DD (or Date) to BS parts. Prefers NepalDateLib; falls back to null. */
export const adToBs = (ad: string | Date): BsParts | null => {
    if (!hasNepaliLib()) return null
    const date = typeof ad === 'string' ? dayjs(ad).toDate() : ad
    // Use UTC noon to avoid timezone day-shift
    const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12))
    const bs = window.NepaliDateLib!.adToBs(utc)
    return { year: bs.year, month: bs.monthIndex + 1, day: bs.day }
}

/** Convert BS YYYY-MM-DD or parts to AD YYYY-MM-DD. */
export const bsToAd = (bs: string | BsParts): string | null => {
    if (!hasNepaliLib()) return null
    const parts = typeof bs === 'string'
        ? (() => {
            const [y, m, d] = bs.split('-').map(Number)
            return { year: y, month: m, day: d }
        })()
        : bs
    const ad = window.NepaliDateLib!.bsToAd(parts.year, parts.month - 1, parts.day)
    // bsToAd returns a UTC Date — format via UTC parts to avoid timezone shift
    return `${ad.getUTCFullYear()}-${String(ad.getUTCMonth() + 1).padStart(2, '0')}-${String(ad.getUTCDate()).padStart(2, '0')}`
}

/** Format an AD date for display in the active calendar mode. */
export const formatCalendarDate = (ad?: string | Date, format?: string): string => {
    if (!ad) return ''
    const mode = getCalendarMode()

    if (mode === 'AD' || !hasNepaliLib()) {
        return dayjs(ad).format(format || 'YYYY-MM-DD')
    }

    const bs = adToBs(ad)
    if (!bs) return dayjs(ad).format(format || 'YYYY-MM-DD')

    const monthName = window.NepaliDateLib!.MONTH_NAMES_EN_BS[bs.month - 1] || String(bs.month)

    // Map common dayjs-style tokens to a simple BS display
    if (!format || format === 'YYYY-MM-DD') {
        return `${bs.year}-${String(bs.month).padStart(2, '0')}-${String(bs.day).padStart(2, '0')}`
    }
    if (format.includes('Do MMM') || format.includes('MMM YYYY') || format.includes('Do MMM YYYY')) {
        return `${bs.day} ${monthName} ${bs.year}`
    }
    if (format.includes('MMM')) {
        return `${monthName} ${bs.year}`
    }

    return window.NepaliDateLib!.formatDateBS(
        { year: bs.year, monthIndex: bs.month - 1, day: bs.day },
        'YYYY-MM-DD',
        'en'
    )
}

/** Format an AD date in the opposite calendar of the active mode (for secondary labels). */
export const formatAlternateDate = (ad?: string | Date, format?: string): string => {
    if (!ad) return ''
    const mode = getCalendarMode()

    if (mode === 'BS') {
        // Primary is BS → show AD secondary
        return dayjs(ad).format(format || 'YYYY-MM-DD')
    }

    // Primary is AD → show BS secondary
    if (!hasNepaliLib()) return ''
    const bs = adToBs(ad)
    if (!bs) return ''
    return `${bs.year}-${String(bs.month).padStart(2, '0')}-${String(bs.day).padStart(2, '0')}`
}

/** Format AD as BS YYYY-MM-DD regardless of mode. */
export const formatAsBS = (ad?: string | Date): string => {
    if (!ad || !hasNepaliLib()) return ''
    const bs = adToBs(ad)
    if (!bs) return ''
    return `${bs.year}-${String(bs.month).padStart(2, '0')}-${String(bs.day).padStart(2, '0')}`
}

/** Format AD as AD YYYY-MM-DD. */
export const formatAsAD = (ad?: string | Date): string => {
    if (!ad) return ''
    return dayjs(ad).format('YYYY-MM-DD')
}

export type PeriodOption = {
    label: string
    translatedLabel?: string
    fromDate: string
    toDate: string
    fromDateBS?: string
    toDateBS?: string
    format?: string
}

export type BsMonthDay = {
    bsDay: number
    ad: string
    bs: string
}

/** Days in a BS month (1-based month), with AD mapping for each day. */
export const getBsMonthDays = (year: number, month: number): BsMonthDay[] => {
    if (!hasNepaliLib()) return []
    const lib = window.NepaliDateLib!
    const monthIndex = month - 1
    const daysInMonth =
        lib.getDaysInMonth?.(year, monthIndex)
        ?? lib.getMonthLength?.(year, monthIndex)
        ?? 30

    const days: BsMonthDay[] = []
    for (let d = 1; d <= daysInMonth; d++) {
        try {
            const adDate = lib.bsToAd(year, monthIndex, d)
            const ad = `${adDate.getUTCFullYear()}-${String(adDate.getUTCMonth() + 1).padStart(2, '0')}-${String(adDate.getUTCDate()).padStart(2, '0')}`
            days.push({
                bsDay: d,
                ad,
                bs: `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
            })
        } catch {
            break
        }
    }
    return days
}

/** Weekday (0=Sun) of the first day of a BS month. */
export const getBsMonthStartWeekday = (year: number, month: number): number => {
    if (!hasNepaliLib()) return 0
    const ad = window.NepaliDateLib!.bsToAd(year, month - 1, 1)
    return ad.getUTCDay()
}

export const getBsMonthName = (month: number): string => {
    if (!hasNepaliLib()) return String(month)
    return window.NepaliDateLib!.MONTH_NAMES_EN_BS[month - 1] || String(month)
}

export const addBsMonths = (year: number, month: number, offset: number): { year: number; month: number } => {
    const idx = year * 12 + (month - 1) + offset
    return { year: Math.floor(idx / 12), month: (idx % 12) + 1 }
}
