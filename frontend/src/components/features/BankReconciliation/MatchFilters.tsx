import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import _ from '@/lib/translate'
import { Settings } from 'lucide-react'
import { bankRecMatchFilters, bankRecVoucherAmountFilter, bankRecVoucherCustomerFilter, bankRecVoucherDateFilter } from './bankRecAtoms'
import { useAtom } from 'jotai'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { H4 } from '@/components/ui/typography'
import { Input } from '@/components/ui/input'
import { Settings, Filter, X } from 'lucide-react'
import { UnreconciledTransaction } from './utils'
import LinkFieldCombobox from '../../common/LinkFieldCombobox'

const MatchFilters = ({ transaction }: { transaction: UnreconciledTransaction }) => {
    return (
        <div className="flex gap-2">
            <MatchSettings />
            <MatchVoucherFilters transaction={transaction} />
        </div>
    )
}

export const MatchSettings = () => {
    return (
        <Popover>
            <Tooltip>
                <PopoverTrigger asChild>
                    <TooltipTrigger asChild>
                        <Button size='sm' variant='outline' aria-label={_("Configure document types")}>
                            <Settings className="h-4 w-4" />
                        </Button>
                    </TooltipTrigger>
                </PopoverTrigger>
                <TooltipContent>
                    {_("Configure document types")}
                </TooltipContent>
            </Tooltip>
            <PopoverContent className="w-56">
                <div className="flex flex-col gap-4">
                    <H4 className="text-sm font-medium">{_("Document Types")}</H4>
                    <div className="grid grid-cols-1 gap-2">
                        <ToggleSwitch label={_("Payment Entry")} id="payment_entry" />
                        <ToggleSwitch label={_("Journal Entry")} id="journal_entry" />
                        <ToggleSwitch label={_("Purchase Invoice")} id="purchase_invoice" />
                        <ToggleSwitch label={_("Sales Invoice")} id="sales_invoice" />
                        <ToggleSwitch label={_("Expense Claim")} id="expense_claim" />
                        <ToggleSwitch label={_("Bank Transaction")} id="bank_transaction" />
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    )
}

export const MatchVoucherFilters = ({ transaction }: { transaction: UnreconciledTransaction }) => {
    return (
        <Popover>
            <Tooltip>
                <PopoverTrigger asChild>
                    <TooltipTrigger asChild>
                        <Button size='sm' variant='outline' aria-label={_("Filter vouchers")}>
                            <Filter className="h-4 w-4" />
                        </Button>
                    </TooltipTrigger>
                </PopoverTrigger>
                <TooltipContent>
                    {_("Filter vouchers")}
                </TooltipContent>
            </Tooltip>
            <PopoverContent className="w-80">
                <div className="flex flex-col gap-4">
                    <H4 className="text-sm font-medium">{_("Voucher Filters")}</H4>
                    <ToggleSwitch label={_("Show Only Exact Amount")} id="exact_match" />
                    <Separator />
                    <CustomerFilter transaction={transaction} />
                    <DateFilters />
                    <AmountFilters />
                </div>
            </PopoverContent>
        </Popover>
    )
}

const ToggleSwitch = ({ label, id }: { label: string, id: string }) => {

    const [matchFilters, setMatchFilters] = useAtom(bankRecMatchFilters)

    return <div className="flex items-center space-x-2">
        <Switch id={id} checked={matchFilters.includes(id)} onCheckedChange={(checked) => {
            if (checked) {
                setMatchFilters([...matchFilters, id])
            } else {
                setMatchFilters(matchFilters.filter(filter => filter !== id))
            }
        }} />
        <Label htmlFor={id} className="text-xs">{label}</Label>
    </div>
}

const CustomerFilter = ({ transaction }: { transaction: UnreconciledTransaction }) => {
    const [customer, setCustomer] = useAtom(bankRecVoucherCustomerFilter)

    const doctype = (transaction.withdrawal || 0) > 0 ? 'Supplier' : 'Customer'

    return (
        <div className="space-y-1.5">
            <Label className="text-xs font-medium">{doctype === 'Supplier' ? _("Supplier") : _("Customer")}</Label>
            <div className="relative">
                <LinkFieldCombobox
                    doctype={doctype}
                    value={customer}
                    onChange={setCustomer}
                    placeholder={_("Search {0}", [doctype])}
                    buttonClassName="h-8 text-xs"
                />
                {customer && (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="absolute right-8 top-0 h-8 w-8 hover:bg-transparent"
                        onClick={() => setCustomer('')}
                    >
                        <X className="h-3 w-3" />
                    </Button>
                )}
            </div>
        </div>
    )
}

const DateFilters = () => {
    const [dates, setDates] = useAtom(bankRecVoucherDateFilter)

    return (
        <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
                <Label className="text-xs font-medium">{_("From Date")}</Label>
                <Input
                    type="date"
                    value={dates.fromDate || ''}
                    onChange={(e) => setDates({ ...dates, fromDate: e.target.value })}
                    className="h-8 text-xs"
                />
            </div>
            <div className="space-y-1.5">
                <Label className="text-xs font-medium">{_("To Date")}</Label>
                <Input
                    type="date"
                    value={dates.toDate || ''}
                    onChange={(e) => setDates({ ...dates, toDate: e.target.value })}
                    className="h-8 text-xs"
                />
            </div>
        </div>
    )
}

const AmountFilters = () => {
    const [amountFilter, setAmountFilter] = useAtom(bankRecVoucherAmountFilter)

    return (
        <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                    <Label className="text-xs font-medium">{_("Min Amount")}</Label>
                    <Input
                        type="number"
                        placeholder="0"
                        value={amountFilter.min || ''}
                        onChange={(e) => setAmountFilter({ ...amountFilter, min: e.target.value ? Number(e.target.value) : undefined })}
                        className="h-8 text-xs"
                    />
                </div>
                <div className="space-y-1.5">
                    <Label className="text-xs font-medium">{_("Max Amount")}</Label>
                    <Input
                        type="number"
                        placeholder="Any"
                        value={amountFilter.max || ''}
                        onChange={(e) => setAmountFilter({ ...amountFilter, max: e.target.value ? Number(e.target.value) : undefined })}
                        className="h-8 text-xs"
                    />
                </div>
            </div>
            <div className="flex items-center space-x-2">
                <Switch
                    id="include_tds"
                    checked={amountFilter.includeTDS}
                    onCheckedChange={(checked) => setAmountFilter({ ...amountFilter, includeTDS: checked })}
                />
                <Label htmlFor="include_tds" className="text-xs font-medium">
                    {_("Include TDS (1.5%)")}
                </Label>
            </div>
        </div>
    )
}

export default MatchFilters