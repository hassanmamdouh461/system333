export interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  image: string;
  available: boolean;
  createdAt?: string;
  updatedAt?: string;
  branchId?: string;
  isSynced?: boolean;
}

export const CATEGORIES = ['All', 'Kitchen', 'Bar'];
