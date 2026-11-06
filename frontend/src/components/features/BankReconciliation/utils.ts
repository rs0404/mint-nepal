import { ActionLog, bankRecActionLog, bankRecAmountFilter, bankRecDateAtom, bankRecMatchFilters, bankRecSearchText, bankRecSelectedTransactionAtom, bankRecTransactionSortOrder, bankRecTransactionTypeFilter, bankRecUnreconcileModalAtom, bankRecVoucherAmountFilter, bankRecVoucherCustomerFilter, bankRecVoucherDateFilter, SelectedBank, selectedBankAccountAtom, TransactionSortOrder } from './bankRecAtoms'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useMemo } from 'react'
import { SWRConfiguration, useFrappeGetCall, useFrappeGetDoc, useFrappePostCall, useSWRConfig } from 'frappe-react-sdk'
import { BankTransaction } from '@/types/Accounts/BankTransaction'
import { BankAccount } from '@/types/Accounts/BankAccount'
import dayjs from 'dayjs'
import { toast } from 'sonner'
import { BANK_LOGOS } from './logos'
import { getErrorMessage } from '@/lib/frappe'
import { useCurrentCompany } from '@/hooks/useCurrentCompany'
import _ from '@/lib/translate'
import { MintBankTransactionRule } from '@/types/Mint/MintBankTransactionRule'
import { useRef } from 'react'
import type { DebouncedState } from 'usehooks-ts'
import { useDebounceCallback } from 'usehooks-ts'
import Fuse from 'fuse.js'

export const useGetAccountOpeningBalance = () => {

    const companyID = useCurrentCompany()
    const bankAccount = useAtomValue(selectedBankAccountAtom)

    const dates = useAtomValue(bankRecDateAtom)

    const args = useMemo(() => {

        return {
            bank_account: bankAccount?.name,
            company: companyID,
            till_date: dayjs(dates.fromDate).subtract(1, 'days').format('YYYY-MM-DD'),
        }

    }, [companyID, bankAccount?.name, dates.fromDate])

    return useFrappeGetCall('erpnext.accounts.doctype.bank_reconciliation_tool.bank_reconciliation_tool.get_account_balance', args,
        bankAccount ? `bank-reconciliation-account-opening-balance-${bankAccount?.name}-${dates.fromDate}` : null,
        {
            revalidateOnFocus: false
        })
}

export const useGetAccountClosingBalance = () => {

    const companyID = useCurrentCompany()
    const bankAccount = useAtomValue(selectedBankAccountAtom)

    const dates = useAtomValue(bankRecDateAtom)

    const args = useMemo(() => {

        return {
            bank_account: bankAccount?.name,
            company: companyID,
            till_date: dates.toDate,
        }

    }, [companyID, bankAccount?.name, dates.toDate])

    return useFrappeGetCall('erpnext.accounts.doctype.bank_reconciliation_tool.bank_reconciliation_tool.get_account_balance', args,
        bankAccount ? `bank-reconciliation-account-closing-balance-${bankAccount?.name}-${dates.toDate}` : null,
        {
            revalidateOnFocus: false
        }
    )

}

/**
 * Hook to fetch the closing balance set in the database for the given bank and date
 */
export const useGetAccountClosingBalanceAsPerStatement = (swrConfig: SWRConfiguration = {}) => {

    const dates = useAtomValue(bankRecDateAtom)
    const bankAccount = useAtomValue(selectedBankAccountAtom)

    return useFrappeGetCall<{ message: { balance: number, date?: string } }>("mint.apis.bank_account.get_closing_balance_as_per_statement", {
        bank_account: bankAccount?.name,
        date: dates.toDate
    }, bankAccount ? `bank-reconciliation-account-closing-balance-as-per-statement-${bankAccount?.name}-${dates.toDate}` : null, {
        revalidateOnFocus: false,
        ...swrConfig
    })
}

export type UnreconciledTransaction = Pick<BankTransaction, 'name' | 'matched_rule' | 'date' | 'withdrawal' | 'deposit' | 'currency' | 'description' | 'status' | 'transaction_type' | 'reference_number' | 'party_type' | 'party' | 'bank_account' | 'company' | 'unallocated_amount'>


export const useGetUnreconciledTransactions = () => {
    const bankAccount = useAtomValue(selectedBankAccountAtom)
    const dates = useAtomValue(bankRecDateAtom)
    return useFrappeGetCall<{ message: UnreconciledTransaction[] }>('mint.apis.transactions.get_bank_transactions', {
        bank_account: bankAccount?.name,
        from_date: dates.fromDate,
        to_date: dates.toDate
    }, bankAccount ? `bank-reconciliation-unreconciled-transactions-${bankAccount?.name}-${dates.fromDate}-${dates.toDate}` : null, {
        revalidateOnFocus: false,
        revalidateIfStale: false
    })
}

export interface LinkedPayment {
    rank: number,
    doctype: string,
    name: string,
    paid_amount: number,
    reference_no: string,
    reference_date: string,
    posting_date: string,
    party_type?: string,
    party?: string,
    currency: string
}

export const useGetBankTransactions = () => {
    const bankAccount = useAtomValue(selectedBankAccountAtom)
    const dates = useAtomValue(bankRecDateAtom)
    return useFrappeGetCall<{ message: BankTransaction[] }>('mint.apis.transactions.get_bank_transactions', {
        bank_account: bankAccount?.name,
        from_date: dates.fromDate,
        to_date: dates.toDate,
        all_transactions: true
    }, bankAccount ? `bank-reconciliation-bank-transactions-${bankAccount?.name}-${dates.fromDate}-${dates.toDate}` : null)
}


/** SWR keys for a transaction's voucher list all start with this, whatever filters are applied */
export const getVouchersCacheKeyPrefix = (transactionName: string) => `bank-reconciliation-vouchers-${transactionName}-`

/** Combined unallocated amount of the selected transactions, rounded to paisa */
export const getTotalUnallocated = (transactions: UnreconciledTransaction[]) =>
    Math.round(transactions.reduce((acc, t) => acc + (t.unallocated_amount ?? 0), 0) * 100) / 100

/**
 * Vouchers to match against the selected transactions.
 * With several selected, amounts are compared to their combined unallocated amount.
 */
export const useGetVouchersForTransaction = (transactions: UnreconciledTransaction[], search: string = '') => {

    const dates = useAtomValue(bankRecDateAtom)
    const matchFilters = useAtomValue(bankRecMatchFilters)
    const voucherAmountFilter = useAtomValue(bankRecVoucherAmountFilter)
    const voucherCustomerFilter = useAtomValue(bankRecVoucherCustomerFilter)
    const voucherDateFilter = useAtomValue(bankRecVoucherDateFilter)

    const isMultiple = transactions.length > 1
    const transactionNames = transactions.map((t) => t.name)
    const transactionAmount = getTotalUnallocated(transactions)
    let min_amount = voucherAmountFilter.min
    let max_amount = voucherAmountFilter.max

    if (voucherAmountFilter.includeTDS) {
        // Expand/intersect with the net→gross TDS window so user min/max still apply.
        // Standard TDS is 1.5%: bank shows net, voucher may be the pre-TDS gross.
        const tdsMin = transactionAmount
        const tdsMax = (transactionAmount / 0.985) + 0.1
        min_amount = min_amount != null ? Math.max(min_amount, tdsMin) : tdsMin
        max_amount = max_amount != null ? Math.min(max_amount, tdsMax) : tdsMax
    }

    const fromDate = voucherDateFilter.fromDate || dates.fromDate
    const toDate = voucherDateFilter.toDate || dates.toDate

    // Expense Claim is shown in older saved filter state but ERPNext v15 has no matcher for it
    const documentTypes = (matchFilters ?? ['payment_entry', 'journal_entry']).filter(
        (filter) => filter !== 'expense_claim'
    )

    // Search looks across all dates on the server; internal transfers from any date are always included
    return useFrappeGetCall<{ message: LinkedPayment[] }>(isMultiple ? 'mint.apis.bank_reconciliation.get_vouchers_for_transactions' : 'mint.apis.bank_reconciliation.get_vouchers_for_transaction', {
        ...(isMultiple ? { bank_transaction_names: JSON.stringify(transactionNames) } : { bank_transaction_name: transactions[0]?.name }),
        document_types: documentTypes,
        from_date: fromDate,
        to_date: toDate,
        party: voucherCustomerFilter || undefined,
        min_amount: min_amount,
        max_amount: max_amount,
        search: search || undefined
    }, `${getVouchersCacheKeyPrefix(transactionNames[0])}${isMultiple ? `${transactionNames.join(',')}-` : ''}${fromDate}-${toDate}-${documentTypes.join(',')}-${voucherCustomerFilter}-${min_amount}-${max_amount}-${voucherAmountFilter.includeTDS}-${search}`, {
        revalidateOnFocus: false
    })
}


/**
 * Common hook to refresh the unreconciled transactions list after a transaction is reconciled
 * @returns function to call to refresh the unreconciled transactions list AFTER the operation is done
 */
export const useRefreshUnreconciledTransactions = () => {

    const selectedBank = useAtomValue(selectedBankAccountAtom)
    const dates = useAtomValue(bankRecDateAtom)
    const setSelectedTransaction = useSetAtom(bankRecSelectedTransactionAtom(selectedBank?.name || ''))

    const { mutate } = useSWRConfig()

    const searchString = useAtomValue(bankRecSearchText)
    const typeFilter = useAtomValue(bankRecTransactionTypeFilter)
    const amountFilter = useAtomValue(bankRecAmountFilter)
    const sortOrder = useAtomValue(bankRecTransactionSortOrder)

    const { data: unreconciledTransactions } = useGetUnreconciledTransactions()

    /** 
     * This function should be called after a transaction is reconciled
     * It will get the next unreconciled transaction and select it
     * And then refresh the balance + unreconciled transactions list
     */
    const onReconcileTransaction = (transaction: UnreconciledTransaction, updatedTransaction?: BankTransaction) => {

        // If the updated transaction has an unallocated amount of 0, then we need to select the next unreconciled transaction
        if (updatedTransaction && updatedTransaction?.unallocated_amount !== 0) {
            mutate(`bank-reconciliation-unreconciled-transactions-${selectedBank?.name}-${dates.fromDate}-${dates.toDate}`)
            mutate(`bank-reconciliation-account-closing-balance-${selectedBank?.name}-${dates.toDate}`)
            // Keep the partly matched transaction selected with its new unallocated amount
            setSelectedTransaction([{ ...transaction, unallocated_amount: updatedTransaction.unallocated_amount }])
            // Update the matching vouchers for the selected transaction (every filter combination)
            const prefix = getVouchersCacheKeyPrefix(transaction.name)
            mutate((key) => typeof key === 'string' && key.startsWith(prefix))
            return
        }

        // From unreconciled transactions list, first apply the filters based on the search criteria and other filters

        const searchIndex = unreconciledTransactions ? new Fuse(unreconciledTransactions.message, {
            keys: ['description', 'reference_number'],
            threshold: 0.3,
            ignoreLocation: true,
            includeScore: true
        }) : null

        const results = getSearchResults(searchIndex, searchString, typeFilter, amountFilter, unreconciledTransactions?.message, sortOrder)

        const currentIndex = results.findIndex(t => t.name === transaction.name)
        let nextTransaction = null

        if (currentIndex !== -1) {
            // Check if there is a next transaction
            if (currentIndex < (results.length || 0) - 1) {
                nextTransaction = results[currentIndex + 1]
            }
        }

        // We need to select the next unreconciled transaction for a better UX
        mutate(`bank-reconciliation-unreconciled-transactions-${selectedBank?.name}-${dates.fromDate}-${dates.toDate}`)
            .then(res => {
                if (nextTransaction) {
                    // Check if next transaction is there in the response
                    const nextTransactionObj = res?.message.find((t: UnreconciledTransaction) => t.name === nextTransaction.name)
                    if (nextTransactionObj) {
                        setSelectedTransaction([nextTransactionObj])
                    } else {
                        // If the next transaction is not there in the response, we need to clear the selection
                        setSelectedTransaction([])
                    }
                } else {
                    // If there is no next transaction, we need to clear the selection
                    setSelectedTransaction([])
                }
            })
        mutate(`bank-reconciliation-account-closing-balance-${selectedBank?.name}-${dates.toDate}`)
    }

    return onReconcileTransaction

}

export const useReconcileTransaction = () => {

    const { call, loading } = useFrappePostCall<{ message: BankTransaction }>('mint.apis.bank_reconciliation.reconcile_vouchers')

    const onReconcileTransaction = useRefreshUnreconciledTransactions()

    const setBankRecUnreconcileModalAtom = useSetAtom(bankRecUnreconcileModalAtom)

    const addToActionLog = useUpdateActionLog()

    /** Match one voucher, or several vouchers against the same bank transaction */
    const reconcileTransaction = (transaction: UnreconciledTransaction, voucherOrVouchers: LinkedPayment | LinkedPayment[]) => {

        const vouchers = Array.isArray(voucherOrVouchers) ? voucherOrVouchers : [voucherOrVouchers]

        return call({
            bank_transaction_name: transaction.name,
            vouchers: JSON.stringify(vouchers.map((voucher) => ({
                "payment_doctype": voucher.doctype,
                "payment_name": voucher.name,
                "amount": voucher.paid_amount
            })))
        }).then((res) => {
            addToActionLog({
                type: 'match',
                timestamp: (new Date()).getTime(),
                isBulk: vouchers.length > 1,
                items: vouchers.map((voucher) => ({
                    bankTransaction: res.message,
                    voucher: {
                        reference_doctype: voucher.doctype,
                        reference_name: voucher.name,
                        reference_no: voucher.reference_no,
                        reference_date: voucher.reference_date,
                        posting_date: voucher.posting_date,
                    }
                }))
            })
            onReconcileTransaction(transaction, res.message)
            toast.success(vouchers.length > 1 ? _("Reconciled {0} vouchers", [String(vouchers.length)]) : _("Reconciled"), {
                duration: 4000,
                closeButton: true,
                action: {
                    label: _("Undo"),
                    onClick: () => setBankRecUnreconcileModalAtom(transaction.name)
                },
                actionButtonStyle: {
                    backgroundColor: "rgb(0, 138, 46)"
                }
            })
            return true
        }).catch((error) => {
            console.error(error)
            toast.error(_("Error"), {
                duration: 5000,
                description: getErrorMessage(error)
            })
            return false
        })
    }

    return { reconcileTransaction, loading }

}

/** Match several bank transactions (oldest first) against one or more vouchers */
export const useReconcileMultipleTransactions = () => {

    const { call, loading } = useFrappePostCall<{ message: BankTransaction[] }>('mint.apis.bank_reconciliation.reconcile_multiple_transactions')

    const selectedBank = useAtomValue(selectedBankAccountAtom)
    const dates = useAtomValue(bankRecDateAtom)
    const setSelectedTransaction = useSetAtom(bankRecSelectedTransactionAtom(selectedBank?.name || ''))
    const { mutate } = useSWRConfig()

    const addToActionLog = useUpdateActionLog()

    const reconcileTransactions = (transactions: UnreconciledTransaction[], vouchers: LinkedPayment[]) => {

        return call({
            bank_transaction_names: JSON.stringify(transactions.map((t) => t.name)),
            vouchers: JSON.stringify(vouchers.map((voucher) => ({
                "payment_doctype": voucher.doctype,
                "payment_name": voucher.name,
            })))
        }).then((res) => {
            const updated = res.message
            const voucherByKey = new Map(vouchers.map((v) => [`${v.doctype}::${v.name}`, v]))

            addToActionLog({
                type: 'match',
                timestamp: (new Date()).getTime(),
                isBulk: true,
                items: updated.flatMap((bankTransaction) => (bankTransaction.payment_entries ?? [])
                    .filter((row) => voucherByKey.has(`${row.payment_document}::${row.payment_entry}`))
                    .map((row) => {
                        const voucher = voucherByKey.get(`${row.payment_document}::${row.payment_entry}`) as LinkedPayment
                        return {
                            bankTransaction,
                            voucher: {
                                reference_doctype: voucher.doctype,
                                reference_name: voucher.name,
                                reference_no: voucher.reference_no,
                                reference_date: voucher.reference_date,
                                posting_date: voucher.posting_date,
                            }
                        }
                    }))
            })

            // Keep any selected transaction that still has an unallocated amount, with its new amount
            const updatedByName = new Map(updated.map((t) => [t.name, t]))
            const stillOpen = transactions
                .map((t) => updatedByName.has(t.name) ? { ...t, unallocated_amount: updatedByName.get(t.name)?.unallocated_amount } : t)
                .filter((t) => (t.unallocated_amount ?? 0) > 0)
            setSelectedTransaction(stillOpen)

            mutate(`bank-reconciliation-unreconciled-transactions-${selectedBank?.name}-${dates.fromDate}-${dates.toDate}`)
            mutate(`bank-reconciliation-account-closing-balance-${selectedBank?.name}-${dates.toDate}`)
            mutate((key) => typeof key === 'string' && key.startsWith('bank-reconciliation-vouchers-'))

            const reconciledCount = updated.filter((t) => t.unallocated_amount === 0).length
            toast.success(_("Matched {0} transactions", [String(updated.length)]), {
                duration: 5000,
                closeButton: true,
                description: stillOpen.length > 0
                    ? _("{0} fully reconciled, {1} still have an unallocated amount", [String(reconciledCount), String(stillOpen.length)])
                    : undefined,
            })
            return true
        }).catch((error) => {
            console.error(error)
            toast.error(_("Error"), {
                duration: 5000,
                description: getErrorMessage(error)
            })
            return false
        })
    }

    return { reconcileTransactions, loading }
}

interface BankAccountWithCurrency extends Pick<BankAccount, 'name' | 'bank' | 'account_name' | 'is_credit_card' | 'company' | 'account' | 'account_type' | 'account_subtype' | 'bank_account_no' | 'last_integration_date'> {
    account_currency?: string
}

export const useGetBankAccounts = (onSuccess?: (data?: Omit<SelectedBank, 'logo'>[]) => void, filterFn?: (bank: SelectedBank) => boolean) => {

    const company = useCurrentCompany()

    const { data, isLoading, error } = useFrappeGetCall<{ message: BankAccountWithCurrency[] }>('mint.apis.bank_account.get_list', {
        company: company
    }, undefined, {
        revalidateOnFocus: false,
        revalidateIfStale: false,
        onSuccess: (data) => {
            onSuccess?.(data?.message)
        }
    })

    const banks = useMemo(() => {
        // Match the bank account to the logo
        const banksWithLogos = data?.message.map((bank) => {
            const logo = BANK_LOGOS.find((logo) => logo.keywords.some((keyword) => bank.bank?.toLowerCase().includes(keyword.toLowerCase())))
            return {
                ...bank,
                logo: logo?.logo
            }
        }) ?? []

        if (filterFn) {
            return banksWithLogos.filter(filterFn)
        }

        return banksWithLogos
    }, [data, filterFn])

    return {
        banks,
        isLoading,
        error
    }

}

export const useIsTransactionWithdrawal = (transaction: UnreconciledTransaction) => {
    return useMemo(() => {
        const isWithdrawal = transaction.withdrawal && transaction.withdrawal > 0
        const isDeposit = transaction.deposit && transaction.deposit > 0

        return {
            amount: isWithdrawal ? transaction.withdrawal : transaction.deposit,
            isWithdrawal,
            isDeposit
        }
    }, [transaction])
}

export const useGetRuleForTransaction = (transaction: UnreconciledTransaction) => {

    return useFrappeGetDoc<MintBankTransactionRule>('Mint Bank Transaction Rule', transaction.matched_rule,
        transaction.matched_rule ? undefined : null, {
        revalidateOnFocus: false,
        revalidateIfStale: false
    }
    )
}

/** Hook to handle the search input while maintaining debouncing and global state. */
export function useTransactionSearch(): [string, DebouncedState<(value: string) => void>] {
    const delay = 500
    const unwrappedInitialValue = ''
    const eq = (left: string, right: string) => left === right
    const [debouncedValue, setDebouncedValue] = useAtom(bankRecSearchText)
    const previousValueRef = useRef<string | undefined>(unwrappedInitialValue)

    const updateDebouncedValue = useDebounceCallback(
        setDebouncedValue,
        delay,
    )

    // Update the debounced value if the initial value changes
    if (!eq(previousValueRef.current as string, unwrappedInitialValue)) {
        updateDebouncedValue(unwrappedInitialValue)
        previousValueRef.current = unwrappedInitialValue
    }

    return [debouncedValue, updateDebouncedValue]
}

/** Sort transactions by date, using the name as a tie-breaker so same-day rows keep a stable order. Returns a new array. */
export const sortTransactionsByDate = <T extends { date?: string, name: string }>(transactions: T[], sortOrder: TransactionSortOrder): T[] => {
    const direction = sortOrder === 'Newest' ? -1 : 1
    return [...transactions].sort((a, b) => {
        const byDate = (a.date ?? '').localeCompare(b.date ?? '')
        return direction * (byDate !== 0 ? byDate : a.name.localeCompare(b.name))
    })
}

/** Utility function to get the search results based on the search index, search string, type filter, amount filter and unreconciled transactions */
export const getSearchResults = (
    /** Fuse index of the unreconciled transactions */
    searchIndex: Fuse<UnreconciledTransaction> | null,
    /** Search string */
    search: string,
    /** Type filter */
    typeFilter: string,
    /** Amount filter */
    amountFilter: string,
    /** Unreconciled transactions */
    unreconciledTransactions?: UnreconciledTransaction[],
    /** Order by transaction date */
    sortOrder: TransactionSortOrder = 'Oldest') => {

    let r = []
    if (!searchIndex || !search) {
        r = unreconciledTransactions ?? []
    } else {
        r = searchIndex.search(search).map((result) => result.item)
    }

    if (typeFilter !== 'All') {
        r = r.filter((transaction) => {
            if (typeFilter === 'Debits') {
                return transaction.withdrawal && transaction.withdrawal > 0
            }
            if (typeFilter === 'Credits') {
                return transaction.deposit && transaction.deposit > 0
            }
        })
    }

    if (amountFilter !== '') {
        const parseRange = (filter: string) => {
            const rangeParts = filter.split(/[-]| to /i)
            if (rangeParts.length === 2) {
                const min = parseFloat(rangeParts[0].trim())
                const max = parseFloat(rangeParts[1].trim())
                if (!isNaN(min) && !isNaN(max)) {
                    return { min, max }
                }
            }
            return null
        }

        const range = parseRange(amountFilter)

        r = r.filter((transaction) => {
            const amount = (transaction.withdrawal && transaction.withdrawal > 0) ? transaction.withdrawal : transaction.deposit || 0
            
            if (range) {
                return amount >= range.min && amount <= range.max
            }

            // Partial string match as requested (e.g., '9' matches '90', '9001')
            const amountStr = amount.toString()
            return amountStr.includes(amountFilter)
        })
    }

    return sortTransactionsByDate(r, sortOrder)
}

export const useUpdateActionLog = () => {

    const setActionLog = useSetAtom(bankRecActionLog)

    const addToActionLog = (action: ActionLog) => {
        // Store at max 100 actions
        setActionLog((prev) => {
            const newActions = [action, ...prev]
            if (newActions.length > 100) {
                return newActions.slice(0, 100)
            }
            return newActions
        })
    }

    return addToActionLog
}