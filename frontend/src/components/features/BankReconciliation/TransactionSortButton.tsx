import { useAtom } from 'jotai'
import { ArrowDownWideNarrow, ArrowUpNarrowWide } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import _ from '@/lib/translate'
import { bankRecTransactionSortOrder } from './bankRecAtoms'

/** Toggles the transaction list between oldest-first and newest-first. */
const TransactionSortButton = ({ className }: { className?: string }) => {
    const [sortOrder, setSortOrder] = useAtom(bankRecTransactionSortOrder)

    const isNewest = sortOrder === 'Newest'
    const label = isNewest ? _("Newest first") : _("Oldest first")

    return <Tooltip>
        <TooltipTrigger asChild>
            <Button
                variant="outline"
                className={className ?? "h-9 text-nowrap"}
                aria-label={_("Sort by date: {0}", [label])}
                onClick={() => setSortOrder(isNewest ? 'Oldest' : 'Newest')}>
                {isNewest ? <ArrowDownWideNarrow className="w-4 h-4" /> : <ArrowUpNarrowWide className="w-4 h-4" />}
                {label}
            </Button>
        </TooltipTrigger>
        <TooltipContent>{_("Sort by date")}</TooltipContent>
    </Tooltip>
}

export default TransactionSortButton
