import { useAtom } from 'jotai'
import { bankRecDateAtom } from './bankRecAtoms'
import { useEffect, useMemo, useState } from 'react'
import { AVAILABLE_TIME_PERIODS, formatDate, getDatesForTimePeriod, TimePeriod } from '@/lib/date'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ChevronDownIcon, ChevronRight } from 'lucide-react'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { parse } from "chrono-node"
import { Calendar } from '@/components/ui/calendar'
import useFiscalYear from '@/hooks/useFiscalYear'
import dayjs from 'dayjs'
import _ from '@/lib/translate'
import { calendarModeAtom, type CalendarMode, type PeriodOption } from '@/lib/nepaliDate'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useFrappeGetCall } from 'frappe-react-sdk'
import BSCalendarRange from '@/components/common/BSCalendarRange'

const BankRecDateFilter = () => {

    const [bankRecDate, setBankRecDate] = useAtom(bankRecDateAtom)
    const [calendarMode, setCalendarMode] = useAtom(calendarModeAtom)

    const { data: fiscalYear } = useFiscalYear()

    const { data: bsPeriodData } = useFrappeGetCall<{
        message: { options: PeriodOption[]; fy_label?: string }
    }>('mint.apis.nepali_date.get_period_options', {
        calendar: 'BS'
    }, calendarMode === 'BS' ? 'mint-bs-period-options' : null, {
        revalidateOnFocus: false,
        revalidateIfStale: false,
    })

    const bsOptions = useMemo(() => (bsPeriodData?.message?.options ?? []).map((o) => ({
        ...o,
        format: o.format || 'Do MMM YYYY',
    })), [bsPeriodData])

    // On first load in BS mode, if the stored range is still the Gregorian default month,
    // snap to the current BS month once options arrive.
    useEffect(() => {
        if (calendarMode !== 'BS' || bsOptions.length === 0) return
        const thisMonth = bsOptions.find((o) => o.label === 'This Month')
        if (!thisMonth) return
        const gregorian = getDatesForTimePeriod('This Month')
        if (bankRecDate.fromDate === gregorian.fromDate && bankRecDate.toDate === gregorian.toDate) {
            setBankRecDate({ fromDate: thisMonth.fromDate, toDate: thisMonth.toDate })
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [calendarMode, bsOptions])

    const timePeriodOptions = useMemo(() => {
        if (calendarMode === 'BS' && bsOptions.length > 0) {
            return bsOptions.map((period) => ({
                label: period.label,
                fromDate: period.fromDate,
                toDate: period.toDate,
                // Prefer API BS labels so the dropdown shows BS, not AD
                displayFrom: period.fromDateBS,
                displayTo: period.toDateBS,
                format: "Do MMM 'YY",
                translatedLabel: _(period.label),
            }))
        }

        const standardOptions = AVAILABLE_TIME_PERIODS.map((period) => {
            const dates = getDatesForTimePeriod(period)
            return {
                label: period,
                fromDate: dates.fromDate,
                toDate: dates.toDate,
                format: dates.format,
                translatedLabel: dates.translatedLabel
            }
        })

        if (fiscalYear?.message) {
            const fiscalYearStart = fiscalYear.message.year_start_date
            const fiscalYearEnd = fiscalYear.message.year_end_date

            const q1 = {
                label: `Q1: ${fiscalYear.message.name}`,
                translatedLabel: `${_("Q1")}: ${fiscalYear.message.name}`,
                fromDate: fiscalYearStart,
                toDate: dayjs(fiscalYearStart).add(3, 'month').format('YYYY-MM-DD'),
                format: 'MMM YYYY'
            }

            const q2 = {
                label: `Q2: ${fiscalYear.message.name}`,
                translatedLabel: `${_("Q2")}: ${fiscalYear.message.name}`,
                fromDate: dayjs(fiscalYearStart).add(3, 'month').format('YYYY-MM-DD'),
                toDate: dayjs(fiscalYearStart).add(6, 'month').format('YYYY-MM-DD'),
                format: 'MMM YYYY'
            }

            const q3 = {
                label: `Q3: ${fiscalYear.message.name}`,
                translatedLabel: `${_("Q3")}: ${fiscalYear.message.name}`,
                fromDate: dayjs(fiscalYearStart).add(6, 'month').format('YYYY-MM-DD'),
                toDate: dayjs(fiscalYearStart).add(9, 'month').format('YYYY-MM-DD'),
                format: 'MMM YYYY'
            }

            const q4 = {
                label: `Q4: ${fiscalYear.message.name}`,
                translatedLabel: `${_("Q4")}: ${fiscalYear.message.name}`,
                fromDate: dayjs(fiscalYearStart).add(9, 'month').format('YYYY-MM-DD'),
                toDate: fiscalYearEnd,
                format: 'MMM YYYY'
            }

            const thisYear = {
                label: `This Fiscal Year`,
                translatedLabel: `${_("This Fiscal Year")}`,
                fromDate: fiscalYearStart,
                toDate: fiscalYearEnd,
                format: 'MMM YYYY'
            }

            const lastYear = {
                label: `Last Fiscal Year`,
                translatedLabel: `${_("Last Fiscal Year")}`,
                fromDate: dayjs(fiscalYearStart).subtract(1, 'year').format('YYYY-MM-DD'),
                toDate: dayjs(fiscalYearEnd).subtract(1, 'year').format('YYYY-MM-DD'),
                format: 'MMM YYYY'
            }

            const topRankedItems = standardOptions.filter((option) => {
                return option.label === "This Month" || option.label === "Last Month"
            })

            const bottomRankedItems = standardOptions.filter((option) => {
                return option.label !== "This Month" && option.label !== "Last Month"
            })

            return [...topRankedItems, q1, q2, q3, q4, thisYear, lastYear, ...bottomRankedItems]
        }

        return standardOptions
    }, [fiscalYear, calendarMode, bsOptions])

    const [open, setOpen] = useState(false)
    const [value, setValue] = useState("")

    const timePeriod: TimePeriod | string = useMemo(() => {
        if (bankRecDate.fromDate && bankRecDate.toDate) {
            for (const period of timePeriodOptions) {
                if (period.fromDate === bankRecDate.fromDate && period.toDate === bankRecDate.toDate) {
                    return period.label;
                }
            }
            return "Date Range";
        } else {
            return "Date Range";
        }
    }, [bankRecDate.fromDate, bankRecDate.toDate, timePeriodOptions]);

    const handleTimePeriodChange = (fromDate: string, toDate: string) => {
        setBankRecDate({ fromDate, toDate })
        setOpen(false)
    }

    const onCalendarModeChange = (useAd: boolean) => {
        const next: CalendarMode = useAd ? 'AD' : 'BS'
        setCalendarMode(next)
    }

    const dateObj = useMemo(() => {
        return {
            from: new Date(bankRecDate.fromDate),
            to: new Date(bankRecDate.toDate)
        }
    }, [bankRecDate.fromDate, bankRecDate.toDate])

    return <div className='flex items-center gap-2'>
        <div className='flex items-center gap-1.5 rounded-md border px-2 h-9'>
            <Label htmlFor='mint-calendar-mode' className='text-xs text-muted-foreground whitespace-nowrap'>
                {calendarMode === 'BS' ? _('BS') : _('AD')}
            </Label>
            <Switch
                id='mint-calendar-mode'
                checked={calendarMode === 'AD'}
                onCheckedChange={onCalendarModeChange}
                aria-label={_("Toggle AD date")}
            />
            <span className='text-[10px] text-muted-foreground'>{_("AD")}</span>
        </div>

        <div className='flex items-center'>
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button
                        variant={'outline'}
                        aria-expanded={open}
                        className='rounded-r-none border-r-0'
                        role="combobox">
                        {timePeriodOptions.find((period) => period.label === timePeriod)?.translatedLabel ?? _(timePeriod)}

                        <ChevronDownIcon />
                    </Button>
                </PopoverTrigger>

                <PopoverContent className="w-84 p-0" align='start'>
                    <Command>

                        <CommandInput placeholder="e.g. Last 3 weeks" onValueChange={setValue} value={value} />
                        <CommandList className='max-h-fit'>
                            <CommandEmpty className='text-left p-2 hover:bg-muted'>
                                <EmptyState onSelect={handleTimePeriodChange} value={value} />
                            </CommandEmpty>
                            {timePeriodOptions.map((period) => (
                                <CommandItem key={period.label} className='flex justify-between' onSelect={() => handleTimePeriodChange(period.fromDate, period.toDate)}>
                                    <span>
                                        {period.translatedLabel ?? _(period.label)}
                                    </span>
                                    <span className='text-xs text-muted-foreground flex items-center gap-1 text-right whitespace-nowrap font-mono'>
                                        {('displayFrom' in period && period.displayFrom)
                                            ? period.displayFrom
                                            : formatDate(period.fromDate, period.format)}
                                        <ChevronRight className='text-[12px] text-muted-foreground/70' />
                                        {('displayTo' in period && period.displayTo)
                                            ? period.displayTo
                                            : formatDate(period.toDate, period.format)}
                                    </span>
                                </CommandItem>
                            ))}
                        </CommandList>
                    </Command>

                </PopoverContent>
            </Popover>

            <Popover>
                <PopoverTrigger asChild>
                    <Button variant={'outline'} className='rounded-l-none'>
                        {formatDate(bankRecDate.fromDate)} - {formatDate(bankRecDate.toDate)}
                    </Button>
                </PopoverTrigger>
                <PopoverContent className='w-auto overflow-hidden p-0' align='end'>
                    {calendarMode === 'BS' ? (
                        <BSCalendarRange
                            fromDate={bankRecDate.fromDate}
                            toDate={bankRecDate.toDate}
                            onSelect={(fromDate, toDate) => setBankRecDate({ fromDate, toDate })}
                        />
                    ) : (
                        <Calendar
                            mode='range'
                            captionLayout='dropdown'
                            selected={{
                                from: dateObj.from,
                                to: dateObj.to
                            }}
                            numberOfMonths={2}
                            defaultMonth={dateObj.from}
                            onSelect={(date) => {
                                if (date) {
                                    setBankRecDate({ fromDate: formatDate(date.from, 'YYYY-MM-DD'), toDate: formatDate(date.to, 'YYYY-MM-DD') })
                                }
                            }}
                        />
                    )}
                </PopoverContent>
            </Popover>
        </div>
    </div>
}

const referentialKeywords = ["last", "this", "next", "previous"]
const EmptyState = ({ onSelect, value }: { onSelect: (fromDate: string, toDate: string) => void, value: string }) => {

    const dates = useMemo(() => {
        if (value) {
            const parsedDate = parse(value, undefined, { forwardDate: false })

            if (parsedDate && parsedDate.length > 0) {
                const startDate = parsedDate[0].start.date()
                const endDate = parsedDate[0].end?.date()

                if (!endDate) {
                    const today = new Date()
                    if (startDate.getTime() > today.getTime()) {
                        return { fromDate: today, toDate: startDate }
                    } else {
                        // @ts-expect-error - "Known Values" is available in the start "ParsingComponents"
                        if (parsedDate[0].start.knownValues?.month && !parsedDate[0].start.knownValues?.day) {
                            return {
                                fromDate: startDate,
                                toDate: dayjs(startDate).endOf('month').toDate()
                            }
                            // @ts-expect-error - "Known Values" is available in the start "ParsingComponents"
                        } else if (parsedDate[0].start.knownValues?.month && parsedDate[0].start.knownValues?.day && !referentialKeywords.some(keyword => value.toLowerCase().includes(keyword))) {
                            return {
                                fromDate: startDate,
                                toDate: startDate,
                            }
                        }

                        return {
                            fromDate: startDate,
                            toDate: today
                        }
                    }
                } else {
                    return { fromDate: startDate, toDate: endDate }
                }
            }

        }
    }, [value])

    const onClick = (fromDate: Date, toDate: Date) => {
        onSelect(formatDate(fromDate, 'YYYY-MM-DD'), formatDate(toDate, 'YYYY-MM-DD'))
    }

    const isEqual = dates?.fromDate && dates?.toDate && dayjs(dates.fromDate).isSame(dates.toDate, 'date')

    return <div>
        {dates ?
            <div className='flex gap-2 items-center justify-between cursor-pointer' onClick={() => onClick(dates.fromDate, dates.toDate)}>
                <span className='text-sm text-muted-foreground max-w-[30%]'>
                    {value}
                </span>
                {isEqual ? <span className='text-xs text-muted-foreground font-mono text-balance flex items-center gap-1'>
                    {formatDate(dates.fromDate, 'Do MMM YYYY')}
                </span> :
                    <span className='text-xs text-muted-foreground font-mono flex items-center gap-1'>
                        {formatDate(dates.fromDate, 'Do MMM YY')} <ChevronRight size='16' className='text-muted-foreground/70' /> {formatDate(dates.toDate, 'Do MMM YY')}
                    </span>}
            </div> :
            <span className='text-sm text-muted-foreground'>
                No results found
            </span>
        }
    </div>
}

export default BankRecDateFilter
