import { useAtomValue } from 'jotai'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import _ from '@/lib/translate'
import { bankRecDateAtom, selectedBankAccountAtom } from './bankRecAtoms'

/** Downloads the selected bank account's transactions for the selected dates as an Excel statement. */
const ExportStatementButton = ({ className }: { className?: string }) => {
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
        <TooltipContent>{_("Download these transactions as an Excel statement")}</TooltipContent>
    </Tooltip>
}

export default ExportStatementButton
