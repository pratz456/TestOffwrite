import { plaidClient } from './client'
import { CountryCode, Products } from 'plaid'
import { db } from '../firebase/client'
import { doc, setDoc, getDoc } from 'firebase/firestore'

// Plaid authentication functions
export async function createLinkToken(userId: string) {
  const request = {
    user: { client_user_id: userId },
    client_name: 'WriteOff App',
    products: ['transactions' as Products],
    country_codes: ['US' as CountryCode],
    language: 'en',
  }

  try {
    const response = await plaidClient.linkTokenCreate(request)
    return { success: true, linkToken: response.data.link_token }
  } catch (error) {
    console.error('Error creating link token:', error)
    return { success: false, error }
  }
}

export async function exchangePublicToken(publicToken: string, userId: string) {
  try {
    const response = await plaidClient.itemPublicTokenExchange({
      public_token: publicToken,
    })

    const accessToken = response.data.access_token
    const itemId = response.data.item_id

    // Store Plaid token in Firestore
    const userRef = doc(db, 'users', userId)
    await setDoc(userRef, { 
      plaid_token: accessToken,
      plaid_item_id: itemId 
    }, { merge: true })

    return { success: true, accessToken, itemId }
  } catch (error) {
    console.error('Error exchanging public token:', error)
    return { success: false, error }
  }
}

export async function removePlaidConnection(userId: string) {
  try {
    // Remove Plaid token from Firestore
    const userRef = doc(db, 'users', userId)
    await setDoc(userRef, { 
      plaid_token: '',
      plaid_item_id: '' 
    }, { merge: true })

    return { success: true }
  } catch (error) {
    console.error('Error removing Plaid connection:', error)
    return { success: false, error }
  }
} 