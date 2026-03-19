import { plaidClient } from './client'
import { getCurrentUser } from '../firebase/auth'
import { getAccounts, addAccount } from '../database/accounts'
import { updateAccount } from '../firebase/accounts'
import { addTransaction } from '../database/transactions'
import { db } from '../firebase/client'
import { doc, getDoc } from 'firebase/firestore'
import { fetchAllPlaidTransactions } from './pagination'

// Plaid transaction functions
export async function fetchTransactions(userId: string) {
  try {
    console.log(`🔍 Starting fetchTransactions for userId: ${userId}`)

    // Get user's Plaid access token from Firestore
    const { data: authData } = await getCurrentUser()
    const user = authData?.user
    console.log(`👤 User data retrieved:`, user ? 'Found user' : 'No user found')

    if (!user) {
      console.log(`❌ No user found`)
      return { success: false, error: 'No user found' }
    }

    // Get Plaid token from Firestore
    const userRef = doc(db, 'users', user.id)
    const userDoc = await getDoc(userRef)
    const userData = userDoc.data()

    if (!userData?.plaid_token) {
      console.log(`❌ No Plaid token found for user ${userId}`)
      return { success: false, error: 'No Plaid token found' }
    }

    console.log(`🔑 Plaid token found, proceeding with transaction fetch`)

    // Get accounts from Plaid
    console.log(`📊 Fetching accounts from Plaid...`)
    const accountsResponse = await plaidClient.accountsGet({
      access_token: userData.plaid_token,
    })

    const plaidAccounts = accountsResponse.data.accounts
    console.log(`✅ Retrieved ${plaidAccounts.length} accounts from Plaid`)

    // Store or update accounts in our database
    for (const account of plaidAccounts) {
      const existingAccount = await getAccounts(userId)
      const accountExists = existingAccount.data?.some(acc => acc.account_id === account.account_id)

      if (!accountExists) {
        await addAccount({
          account_id: account.account_id,
          user_id: userId,
        })
      }
    }

    // Get transactions from Plaid for each account
    let totalTransactions = 0

    for (const account of plaidAccounts) {
      // Calculate date range - default to 1 year for historical data
      const endDate = new Date();
      const startDate = new Date();
      startDate.setFullYear(endDate.getFullYear() - 1); // 1 year back instead of 6 months

      // Fetch all transactions with pagination
      const { transactions, totalPages, totalTransactions: accountTransactionCount } = await fetchAllPlaidTransactions(
        plaidClient,
        {
          access_token: userData.plaid_token,
          start_date: startDate.toISOString().split('T')[0],
          end_date: endDate.toISOString().split('T')[0],
          options: {
            account_ids: [account.account_id],
            include_personal_finance_category: true,
          },
        },
        `[Account ${account.account_id}]`
      );

      console.log(`📊 Total transactions fetched for account ${account.account_id}: ${accountTransactionCount} across ${totalPages} page(s)`);

      // Store transactions — tax treatment is user-confirmed only (same as server-side Plaid sync).
      for (const txn of transactions) {
        const transactionData = {
          trans_id: txn.transaction_id,
          account_id: account.account_id,
          date: txn.date,
          amount: txn.amount,
          merchant_name: txn.merchant_name || 'Unknown Merchant',
          category: txn.category?.join(', ') || 'Uncategorized',
          is_deductible: null as null,
          analyzed: false,
          analysis_status: 'pending' as const,
          analysisStatus: 'pending' as const,
        };

        await addTransaction(userId, account.account_id, transactionData);
        console.log(`💾 Transaction saved: ${transactionData.merchant_name} - $${transactionData.amount}`);
      }

      totalTransactions += transactions.length
    }

    console.log(`🎉 Successfully fetched and stored ${totalTransactions} transactions`)
    return { success: true, count: totalTransactions }
  } catch (error) {
    console.error('❌ Error in fetchTransactions:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export async function getAccountBalances(userId: string) {
  try {
    const { data: authData } = await getCurrentUser()
    const user = authData?.user
    if (!user) {
      return { success: false, error: 'No user found' }
    }

    // Get Plaid token from Firestore
    const userRef = doc(db, 'users', user.id)
    const userDoc = await getDoc(userRef)
    const userData = userDoc.data()

    if (!userData?.plaid_token) {
      return { success: false, error: 'No Plaid token found' }
    }

    const response = await plaidClient.accountsGet({
      access_token: userData.plaid_token,
    })

    return { success: true, accounts: response.data.accounts }
  } catch (error) {
    console.error('Error fetching account balances:', error)
    return { success: false, error }
  }
}

export async function getInstitutionInfo(userId: string) {
  try {
    const { data: authData } = await getCurrentUser()
    const user = authData?.user
    if (!user) {
      return { success: false, error: 'No user found' }
    }

    // Get Plaid token from Firestore
    const userRef = doc(db, 'users', user.id)
    const userDoc = await getDoc(userRef)
    const userData = userDoc.data()

    if (!userData?.plaid_token) {
      return { success: false, error: 'No Plaid token found' }
    }

    const response = await plaidClient.itemGet({
      access_token: userData.plaid_token,
    })

    if (!response.data.item.institution_id) {
      return { success: false, error: 'No institution ID found' }
    }

    const institutionResponse = await plaidClient.institutionsGetById({
      institution_id: response.data.item.institution_id,
      country_codes: ['US' as any],
    })

    return { success: true, institution: institutionResponse.data.institution }
  } catch (error) {
    console.error('Error fetching institution info:', error)
    return { success: false, error }
  }
}