import { useAtomValue } from "jotai"
import { MissingFiltersBanner } from "./MissingFiltersBanner"
import { bankRecDateAtom, selectedBankAccountAtom } from "./bankRecAtoms"
import { useCurrentCompany } from "@/hooks/useCurrentCompany"
import { Paragraph } from "@/components/ui/typography"
import { useMemo, useState } from "react"
import { useFrappeGetCall } from "frappe-react-sdk"
import { QueryReportReturnType } from "@/types/custom/Reports"
import { formatDate } from "@/lib/date"
import { Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatCurrency } from "@/lib/numbers"
import { getCompanyCurrency } from "@/lib/company"
import { slug } from "@/lib/frappe"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { AlertCircle, ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, FileText, ListIcon, Search, XIcon } from "lucide-react"
import ErrorBanner from "@/components/ui/error-banner"
import { StatContainer, StatLabel, StatValue } from "@/components/ui/stats"
import _ from "@/lib/translate"
import { toast } from "sonner"
import { useCopyToClipboard, useDebounceValue } from "usehooks-ts"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import AmountFilterInput, { AmountFilter } from "./AmountFilterInput"

const BankReconciliationStatement = () => {
    const bankAccount = useAtomValue(selectedBankAccountAtom)
    const dates = useAtomValue(bankRecDateAtom)

    if (!bankAccount) {
        return <MissingFiltersBanner text={_("Please select a bank account to view the bank reconciliation statement.")} />
    }

    if (!dates) {
        return <MissingFiltersBanner text={_("Please select dates to view the bank reconciliation statement.")} />
    }

    return <BankReconciliationStatementView />
}
interface BankClearanceSummaryEntry {
    payment_document: string
    payment_entry: string
    posting_date: string,
    reference_no: string,
    credit: number,
    debit: number,
    against_account: string,
    ref_date: string,
    account_currency: string,
    clearance_date: string
}

type SortKey = 'posting_date' | 'payment_document' | 'payment_entry' | 'debit' | 'credit' | 'against_account' | 'reference_no' | 'ref_date' | 'clearance_date'

interface SortState {
    key: SortKey,
    direction: 'asc' | 'desc'
}

type EntryDirection = 'All' | 'Debits' | 'Credits'

const NUMERIC_SORT_KEYS: SortKey[] = ['debit', 'credit']

/** Compare two entries on a column; blank values always go last */
const compareEntries = (a: BankClearanceSummaryEntry, b: BankClearanceSummaryEntry, { key, direction }: SortState) => {
    const aValue = a[key]
    const bValue = b[key]

    const aBlank = aValue === null || aValue === undefined || aValue === ''
    const bBlank = bValue === null || bValue === undefined || bValue === ''
    if (aBlank || bBlank) {
        return aBlank === bBlank ? 0 : aBlank ? 1 : -1
    }

    const result = NUMERIC_SORT_KEYS.includes(key) ?
        Number(aValue) - Number(bValue) :
        // Dates are YYYY-MM-DD strings, so a string comparison sorts them correctly
        String(aValue).localeCompare(String(bValue), undefined, { numeric: true, sensitivity: 'base' })

    return direction === 'asc' ? result : -result
}

const BankReconciliationStatementView = () => {

    const companyID = useCurrentCompany()
    const bankAccount = useAtomValue(selectedBankAccountAtom)
    const dates = useAtomValue(bankRecDateAtom)

    const filters = useMemo(() => {
        return JSON.stringify({
            account: bankAccount?.account,
            report_date: dates.toDate,
            company: companyID
        })
    }, [bankAccount, dates, companyID])

    const { data, error } = useFrappeGetCall<{ message: QueryReportReturnType }>('frappe.desk.query_report.run', {
        report_name: 'Bank Reconciliation Statement',
        filters,
        ignore_prepared_report: 1,
        are_default_filters: false,
    }, `Report-Bank Reconciliation Statement-${filters}`, { keepPreviousData: true, revalidateOnFocus: false }, 'POST')

    const [, copyToClipboard] = useCopyToClipboard()

    const onCopy = (text: string) => {
        copyToClipboard(text)
            .then(() => {
                toast.success(_("Copied to clipboard"))
            })
    }

    const [searchInput, setSearchInput] = useState('')
    const [search] = useDebounceValue(searchInput, 200)
    const [amountFilter, setAmountFilter] = useState<AmountFilter>({ value: 0, stringValue: '' })
    const [documentType, setDocumentType] = useState('All')
    const [entryDirection, setEntryDirection] = useState<EntryDirection>('All')
    const [sort, setSort] = useState<SortState | null>(null)

    const currency = bankAccount?.account_currency ?? getCompanyCurrency(companyID)

    /** Only real vouchers - the report's balance rows have no document type and are shown in the summary above */
    const entries = useMemo(() => {
        return (data?.message.result ?? []).filter((row: BankClearanceSummaryEntry) => row.payment_document && row.payment_entry) as BankClearanceSummaryEntry[]
    }, [data])

    const documentTypes = useMemo(() => {
        return Array.from(new Set(entries.map((row) => row.payment_document))).sort()
    }, [entries])

    const filteredEntries = useMemo(() => {
        const searchText = search.trim().toLowerCase()

        const filtered = entries.filter((row) => {
            if (searchText) {
                const haystack = [row.payment_entry, row.payment_document, row.against_account, row.reference_no, row.debit, row.credit]
                    .filter((value) => value !== null && value !== undefined)
                    .join(' ')
                    .toLowerCase()
                if (!haystack.includes(searchText)) {
                    return false
                }
            }

            if (documentType !== 'All' && row.payment_document !== documentType) {
                return false
            }

            if (entryDirection === 'Debits' && !(row.debit > 0)) {
                return false
            }

            if (entryDirection === 'Credits' && !(row.credit > 0)) {
                return false
            }

            if (amountFilter.value > 0 && row.debit !== amountFilter.value && row.credit !== amountFilter.value) {
                return false
            }

            return true
        })

        return sort ? [...filtered].sort((a, b) => compareEntries(a, b, sort)) : filtered
    }, [entries, search, documentType, entryDirection, amountFilter, sort])

    const totals = useMemo(() => {
        return filteredEntries.reduce((acc, row) => ({
            debit: acc.debit + (row.debit ?? 0),
            credit: acc.credit + (row.credit ?? 0),
        }), { debit: 0, credit: 0 })
    }, [filteredEntries])

    const hasFilters = searchInput !== '' || amountFilter.value > 0 || documentType !== 'All' || entryDirection !== 'All'

    const clearFilters = () => {
        setSearchInput('')
        setAmountFilter({ value: 0, stringValue: '' })
        setDocumentType('All')
        setEntryDirection('All')
    }

    /** Clicking a column sorts ascending, then descending, then back to the report's order */
    const onSort = (key: SortKey) => {
        setSort((current) => {
            if (!current || current.key !== key) {
                return { key, direction: 'asc' }
            }
            if (current.direction === 'asc') {
                return { key, direction: 'desc' }
            }
            return null
        })
    }

    return <div className="space-y-4 py-2">

        <div>
            <Paragraph className="text-sm">
                <span dangerouslySetInnerHTML={{
                    __html: _("Below is a list of all entries posted against the bank account {0} which have not been cleared till {1}.", [`<strong>${bankAccount?.account}</strong>`, `<strong>${formatDate(dates.toDate)}</strong>`])
                }} />
            </Paragraph>
        </div>

        {error && <ErrorBanner error={error} />}

        {data && <SummarySection data={data} />}

        {entries.length > 0 && <div className="flex py-2 w-full gap-2">
            <label className="sr-only">{_("Search entries")}</label>
            <div className={cn("flex items-center gap-2 w-full rounded-md dark:bg-input/30 border-input border bg-transparent px-2 text-base shadow-xs transition-[color,box-shadow] outline-none",
                "focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]"
            )}>
                <Search className="w-5 h-5 text-muted-foreground" />
                <Input placeholder={_("Search document, account, reference or amount")} type='search' value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
                    className="border-none px-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0" />
                <span className="text-sm text-muted-foreground text-nowrap whitespace-nowrap">{filteredEntries.length} {_(filteredEntries.length === 1 ? "result" : "results")}</span>
            </div>
            <div className="w-[20%] min-w-36">
                <AmountFilterInput currency={currency} amountFilter={amountFilter} setAmountFilter={setAmountFilter} />
            </div>
            <div className="w-[20%] min-w-36">
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" className="w-full h-9 text-left justify-between">
                            <div className="flex gap-2 items-center truncate">
                                <FileText className="w-4 h-4 text-muted-foreground" />
                                {documentType === 'All' ? _("All Document Types") : _(documentType)}
                            </div>
                            <ChevronDown className="w-4 h-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                        <DropdownMenuItem onClick={() => setDocumentType('All')}>{_("All Document Types")}</DropdownMenuItem>
                        {documentTypes.map((type) => <DropdownMenuItem key={type} onClick={() => setDocumentType(type)}>{_(type)}</DropdownMenuItem>)}
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
            <div className="w-[20%] min-w-36">
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" className="w-full h-9 text-left justify-between">
                            <div className="flex gap-2 items-center truncate">
                                <ListIcon className="w-4 h-4 text-muted-foreground" />
                                {entryDirection === 'All' ? _("Debits and Credits") : entryDirection === 'Debits' ? _("Debits only") : _("Credits only")}
                            </div>
                            <ChevronDown className="w-4 h-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                        <DropdownMenuItem onClick={() => setEntryDirection('All')}>{_("Debits and Credits")}</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setEntryDirection('Debits')}>{_("Debits only")}</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setEntryDirection('Credits')}>{_("Credits only")}</DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
            {hasFilters && <Button variant="ghost" className="h-9" onClick={clearFilters}>
                <XIcon className="w-4 h-4" />
                {_("Clear")}
            </Button>}
        </div>}

        {filteredEntries.length > 0 &&
            <Table>
                <TableCaption>{_("Bank Reconciliation Statement")}</TableCaption>
                <TableHeader>
                    <TableRow>
                        <SortableHead label={_("Posting Date")} sortKey="posting_date" sort={sort} onSort={onSort} />
                        <SortableHead label={_("Document Type")} sortKey="payment_document" sort={sort} onSort={onSort} />
                        <SortableHead label={_("Payment Document")} sortKey="payment_entry" sort={sort} onSort={onSort} />
                        <SortableHead label={_("Debit")} sortKey="debit" sort={sort} onSort={onSort} alignRight />
                        <SortableHead label={_("Credit")} sortKey="credit" sort={sort} onSort={onSort} alignRight />
                        <SortableHead label={_("Against Account")} sortKey="against_account" sort={sort} onSort={onSort} />
                        <SortableHead label={_("Reference #")} sortKey="reference_no" sort={sort} onSort={onSort} />
                        <SortableHead label={_("Reference Date")} sortKey="ref_date" sort={sort} onSort={onSort} />
                        <SortableHead label={_("Clearance Date")} sortKey="clearance_date" sort={sort} onSort={onSort} />
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {filteredEntries.map((row) => <TableRow key={`${row.payment_document}-${row.payment_entry}`}>
                        <TableCell>{formatDate(row.posting_date)}</TableCell>
                        <TableCell>{_(row.payment_document)}</TableCell>
                        <TableCell>
                            <a target="_blank" className="underline underline-offset-4" href={`/app/${slug(row.payment_document)}/${row.payment_entry}`}>{row.payment_entry}</a>
                        </TableCell>
                        <TableCell className="text-right">{formatCurrency(row.debit, row.account_currency)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(row.credit, row.account_currency)}</TableCell>
                        <TableCell className="max-w-[250px] overflow-hidden text-ellipsis whitespace-nowrap" title={row.against_account}><a target="_blank" className="underline underline-offset-4" href={`/app/account/${row.against_account}`}>{row.against_account}</a></TableCell>
                        <TableCell>
                            <Tooltip delayDuration={500}>
                                <TooltipTrigger onClick={() => onCopy(row.reference_no)}>
                                    {row.reference_no?.slice(0, 40)}{row.reference_no?.length > 40 ? "..." : ""}
                                </TooltipTrigger>
                                <TooltipContent align='start'>
                                    {_("Copy to clipboard")}
                                </TooltipContent>
                            </Tooltip>
                        </TableCell>
                        <TableCell>{formatDate(row.ref_date)}</TableCell>
                        <TableCell>{formatDate(row.clearance_date)}</TableCell>
                    </TableRow>
                    )}
                </TableBody>
                <TableFooter>
                    <TableRow>
                        <TableCell colSpan={3}>{_("Total ({0} entries)", [String(filteredEntries.length)])}</TableCell>
                        <TableCell className="text-right">{formatCurrency(totals.debit, currency)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(totals.credit, currency)}</TableCell>
                        <TableCell colSpan={4} />
                    </TableRow>
                </TableFooter>
            </Table>}

        {data && entries.length > 0 && filteredEntries.length === 0 &&
            <Alert variant='default'>
                <AlertCircle />
                <AlertTitle>{_("No matching entries")}</AlertTitle>
                <AlertDescription>
                    {_("No outstanding entries match the search and filters.")}
                </AlertDescription>
            </Alert>
        }

        {data && entries.length === 0 &&
            <Alert variant='default'>
                <AlertCircle />
                <AlertTitle>{_("No entries found")}</AlertTitle>
                <AlertDescription>
                    {_("There are no accounting entries in the system for the selected account and dates.")}
                </AlertDescription>
            </Alert>
        }


    </div>
}

const SortableHead = ({ label, sortKey, sort, onSort, alignRight }: {
    label: string,
    sortKey: SortKey,
    sort: SortState | null,
    onSort: (key: SortKey) => void,
    alignRight?: boolean
}) => {
    const isActive = sort?.key === sortKey
    const Icon = !isActive ? ArrowUpDown : sort.direction === 'asc' ? ArrowUp : ArrowDown

    return <TableHead
        className={alignRight ? 'text-right' : undefined}
        aria-sort={isActive ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <button
            type="button"
            onClick={() => onSort(sortKey)}
            className={cn("inline-flex items-center gap-1 hover:text-foreground", alignRight && "flex-row-reverse", isActive ? "text-foreground" : "")}>
            {label}
            <Icon className={cn("w-3.5 h-3.5", isActive ? "" : "text-muted-foreground/60")} />
        </button>
    </TableHead>
}

interface BalanceRow {
    debit?: number,
    credit?: number,
}

const SummarySection = ({ data }: { data: { message: QueryReportReturnType } }) => {

    const company = useCurrentCompany()
    const bankAccount = useAtomValue(selectedBankAccountAtom)

    const { bankStatementBalanceAsPerGL, outstandingChecks, incorrectlyClearedEntriesDebit, incorrectlyClearedEntriesCredit, calculatedBankStatementBalance } = useMemo(() => {

        // The report ends with four balance rows (no document type) in a fixed order. Their labels are translated
        // and ERPNext spells them "Cheques", so read them by position rather than matching on the label.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const balanceRows: BalanceRow[] = (data?.message.result ?? []).filter((r: any) => r?.payment_entry && !r.payment_document)
        const [glRow, outstandingRow, incorrectlyClearedRow, calculatedRow] = balanceRows

        const net = (row?: BalanceRow) => (row?.debit ?? 0) - (row?.credit ?? 0)

        return {
            bankStatementBalanceAsPerGL: net(glRow),
            outstandingChecks: net(outstandingRow),
            incorrectlyClearedEntriesDebit: incorrectlyClearedRow?.debit ?? 0,
            incorrectlyClearedEntriesCredit: incorrectlyClearedRow?.credit ?? 0,
            calculatedBankStatementBalance: net(calculatedRow),
        }

    }, [data])

    const currency = bankAccount?.account_currency ?? getCompanyCurrency(company)

    return <div className="flex gap-4 items-start justify-between">
        <StatContainer>
            <StatLabel>{_("Bank Statement Balance as per General Ledger")}</StatLabel>
            <StatValue className="font-mono">{formatCurrency(bankStatementBalanceAsPerGL, currency)}</StatValue>
        </StatContainer>

        <StatContainer>
            <StatLabel>{_("Outstanding Checks and Deposits to clear")}</StatLabel>
            <StatValue className="font-mono">{formatCurrency(outstandingChecks, currency)}</StatValue>
        </StatContainer>

        {(incorrectlyClearedEntriesDebit > 0 || incorrectlyClearedEntriesCredit > 0) && <StatContainer>
            <StatLabel className="text-destructive">{_("Checks and Deposits incorrectly cleared")}</StatLabel>
            <StatValue className="text-destructive font-mono">{formatCurrency(incorrectlyClearedEntriesDebit - incorrectlyClearedEntriesCredit, currency)}</StatValue>
        </StatContainer>}
        <StatContainer>
            <StatLabel>{_("Calculated Bank Statement Balance")}</StatLabel>
            <StatValue className="font-mono">{formatCurrency(calculatedBankStatementBalance, currency)}</StatValue>
        </StatContainer>

    </div>
}

export default BankReconciliationStatement
