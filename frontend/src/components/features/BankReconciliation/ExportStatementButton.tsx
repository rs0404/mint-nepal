import { useAtomValue } from 'jotai'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import _ from '@/lib/translate'
import { bankRecDateAtom, selectedBankAccountAtom } from './bankRecAtoms'

/** Filters on the Bank Transactions list; the export applies the same ones */
export interface StatementExportFilters {
    search?: string
    amount?: number
    type?: string
    status?: string
}

/**
 * Downloads the selected bank account's transactions for the selected dates as an Excel statement.
 * With `filters` set, only the transactions that match them are exported.
 */
const ExportStatementButton = ({ className, filters, count }: { className?: string, filters?: StatementExportFilters, count?: number }) => {
    const bankAccount = useAtomValue(selectedBankAccountAtom)
    const dates = useAtomValue(bankRecDateAtom)

    if (!bankAccount || !dates) {
        return null
    }

    const params = new URLSearchParams({
        bank_account: bankAccount.name,
        from_date: dates.fromDate,
        to_date: dates.toDate,
    })
    const applied: Record<string, string | undefined> = {
        search: filters?.search?.trim() || undefined,
        amount: filters?.amount && filters.amount > 0 ? String(filters.amount) : undefined,
        type: filters?.type && filters.type !== 'All' ? filters.type : undefined,
        status: filters?.status && filters.status !== 'All' ? filters.status : undefined,
    }
    let isFiltered = false
    for (const [key, value] of Object.entries(applied)) {
        if (value) {
            params.set(key, value)
            isFiltered = true
        }
    }

    const href = `/api/method/mint.apis.statement_export.download_bank_statement?${params.toString()}`

    return <Tooltip>
        <TooltipTrigger asChild>
            <Button variant="outline" className={className ?? "h-9 text-nowrap"} asChild>
                <a href={href} download>
                    <Download className="w-4 h-4" />
                    {_("Export")}
                </a>
            </Button>
        </TooltipTrigger>
        <TooltipContent>{isFiltered
            ? _("Download the {0} filtered transactions as an Excel statement", [String(count ?? 0)])
            : _("Download these transactions as an Excel statement")}</TooltipContent>
    </Tooltip>
}

export default ExportStatementButton
