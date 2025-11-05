import { adminDb } from './admin';
import { CollectionReference, Query } from 'firebase-admin/firestore';

/**
 * Delete all documents in a collection with pagination (batched deletes)
 * @param collectionRef - The Firestore collection reference
 * @param batchSize - Number of documents to delete per batch (max 500)
 * @returns Promise<number> - Total number of documents deleted
 */
export async function deleteCollection(
  collectionRef: CollectionReference,
  batchSize: number = 500
): Promise<number> {
  return deleteQueryBatch(collectionRef.limit(batchSize), batchSize);
}

/**
 * Delete all documents in a subcollection with pagination
 * @param parentRef - The parent document reference
 * @param subcollectionName - Name of the subcollection
 * @param batchSize - Number of documents to delete per batch (max 500)
 * @returns Promise<number> - Total number of documents deleted
 */
export async function deleteSubcollection(
  parentRef: any,
  subcollectionName: string,
  batchSize: number = 500
): Promise<number> {
  const subcollectionRef = parentRef.collection(subcollectionName);
  return deleteCollection(subcollectionRef, batchSize);
}

/**
 * Delete all documents matching a query with pagination
 * @param query - The Firestore query (can be Query or CollectionReference)
 * @param batchSize - Number of documents to delete per batch (max 500)
 * @returns Promise<number> - Total number of documents deleted
 */
export async function deleteQueryBatch(
  query: Query | CollectionReference,
  batchSize: number = 500
): Promise<number> {
  let totalDeleted = 0;
  let lastDoc: any = null;

  while (true) {
    // Build the query with pagination
    let currentQuery: Query;
    if (lastDoc) {
      // Continue from last document - both Query and CollectionReference support limit().startAfter()
      currentQuery = (query as any).limit(batchSize).startAfter(lastDoc);
    } else {
      // First batch - both Query and CollectionReference support limit()
      currentQuery = (query as any).limit(batchSize);
    }

    const snapshot = await currentQuery.get();

    if (snapshot.empty) {
      break;
    }

    const batch = adminDb.batch();
    snapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
      totalDeleted++;
    });

    await batch.commit();

    // If we got fewer docs than the batch size, we're done
    if (snapshot.docs.length < batchSize) {
      break;
    }

    // Get the last document for pagination
    lastDoc = snapshot.docs[snapshot.docs.length - 1];
  }

  return totalDeleted;
}

