'use client';

import { PackageIcon, PlusIcon } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { DataToolbar, ToolbarReset, ToolbarSelect, ToolbarSpacer } from '@/components/data-toolbar';
import { EmptyState } from '@/components/empty-state';
import { PageHeader, PageStack } from '@/components/page-header';
import { CloseProductDialog, ProductDialog } from '@/components/product-dialog';
import { Badge, type badgeVariants } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from '@/components/ui/table';
import { useCurrentUser } from '@/hooks/use-current-user';
import { api, apiErrorMessage, formatDate, formatMoney } from '@/lib/api';
import { PRODUCT_STATUS_LABELS } from '@/lib/fpf-labels';
import type { ProductStatus, ProductSummary } from '@/lib/types';

type BadgeVariant = NonNullable<Parameters<typeof badgeVariants>[0]>['variant'];

const PRODUCT_STATUS_VARIANTS: Record<ProductStatus, BadgeVariant> = {
  IDEA: 'soft-info',
  PACKAGING: 'soft-warning',
  ON_SALE: 'soft-success',
  CLOSED: 'soft-muted',
};

const PRODUCT_STATUS_ORDER: ProductStatus[] = ['IDEA', 'PACKAGING', 'ON_SALE', 'CLOSED'];

/** Radix Select не допускает пустое значение пункта, поэтому «любой статус» — отдельный ключ. */
const ANY_STATUS = 'ALL';

export default function ProductsPage() {
  return (
    <Suspense
      fallback={
        <PageStack>
          <Skeleton className="h-16 w-full max-w-xl" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-72 w-full" />
        </PageStack>
      }
    >
      <ProductsContent />
    </Suspense>
  );
}

function ProductsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { can } = useCurrentUser();
  const [items, setItems] = useState<ProductSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [closing, setClosing] = useState<ProductSummary | null>(null);

  const canWrite = can('products.write');

  const loadProducts = useCallback(async () => {
    setLoading(true);
    setError(null);
    const status = searchParams.get('status');
    try {
      const response = await api<{ items: ProductSummary[] }>(
        `/products${status ? `?status=${status}` : ''}`,
      );
      setItems(response.items);
    } catch (caught) {
      setError(apiErrorMessage(caught, 'Не удалось загрузить продукты'));
    } finally {
      setLoading(false);
    }
  }, [searchParams]);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  async function changeStatus(product: ProductSummary, status: ProductStatus) {
    if (status === 'CLOSED') {
      setClosing(product);
      return;
    }
    try {
      await api(`/products/${product.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ version: product.version, status }),
      });
      toast.success(`«${product.name}»: ${PRODUCT_STATUS_LABELS[status].toLowerCase()}`);
      await loadProducts();
    } catch (caught) {
      toast.error(apiErrorMessage(caught, 'Не удалось изменить статус'));
    }
  }

  const statusFilter = searchParams.get('status') ?? '';
  const columnCount = canWrite ? 7 : 6;

  return (
    <PageStack>
      <PageHeader
        eyebrow="Упаковка механик в продаваемый продукт"
        title="Продукты"
        description="Описание, документация и модель реализации. Если продукт не продаётся — закрывается."
        actions={
          canWrite ? (
            <Button onClick={() => setShowCreate(true)}>
              <PlusIcon /> Новый продукт
            </Button>
          ) : undefined
        }
      />

      <DataToolbar>
        <ToolbarSelect
          label="Статус"
          value={statusFilter || ANY_STATUS}
          onChange={(value) =>
            router.push(value === ANY_STATUS ? '/products' : `/products?status=${value}`)
          }
          options={[
            { value: ANY_STATUS, label: 'Любой статус' },
            ...PRODUCT_STATUS_ORDER.map((value) => ({
              value,
              label: PRODUCT_STATUS_LABELS[value],
            })),
          ]}
        />
        {statusFilter && <ToolbarReset onClick={() => router.push('/products')} />}
        <ToolbarSpacer />
        <span className="text-muted-foreground pb-1.5 text-[13px]">
          Найдено: <span className="text-foreground font-medium tabular">{items.length}</span>
        </span>
      </DataToolbar>

      <Card className="overflow-hidden">
        {error ? (
          <EmptyState title="Ошибка загрузки" text={error} />
        ) : !loading && items.length === 0 ? (
          <EmptyState
            icon={PackageIcon}
            title="Продукты не найдены"
            text="Упакуйте первую механику (ивент, активацию, образование) в продукт."
          />
        ) : (
          <TableWrapper>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Продукт</TableHead>
                  <TableHead>Модель реализации</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead className="text-right">Цена</TableHead>
                  <TableHead className="text-right">Сделок</TableHead>
                  <TableHead className="text-right">Выручка</TableHead>
                  {canWrite && (
                    <TableHead>
                      <span className="sr-only">Действия</span>
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading
                  ? Array.from({ length: 6 }, (_, index) => (
                      <TableRow key={index}>
                        <TableCell colSpan={columnCount}>
                          <Skeleton className="h-5 w-full" />
                        </TableCell>
                      </TableRow>
                    ))
                  : items.map((product) => (
                      <TableRow key={product.id}>
                        <TableCell>
                          <div className="flex items-start gap-2.5">
                            <span className="bg-muted text-muted-foreground mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md">
                              <PackageIcon className="size-4" />
                            </span>
                            <div className="min-w-0">
                              <span className="font-medium">{product.name}</span>
                              {product.documentationUrl && (
                                <>
                                  {' '}
                                  <a
                                    className="text-primary text-[13px] hover:underline"
                                    href={product.documentationUrl}
                                    rel="noopener noreferrer"
                                    target="_blank"
                                  >
                                    документация
                                  </a>
                                </>
                              )}
                              {product.status === 'CLOSED' && product.closeReason && (
                                <p className="text-muted-foreground text-xs">
                                  Закрыт {formatDate(product.closedAt)}: {product.closeReason}
                                </p>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground max-w-72 truncate">
                          {product.deliveryModel ?? '—'}
                        </TableCell>
                        <TableCell>
                          <Badge variant={PRODUCT_STATUS_VARIANTS[product.status]}>
                            {PRODUCT_STATUS_LABELS[product.status]}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular">
                          {product.price === null || product.price === undefined
                            ? '—'
                            : formatMoney(product.price)}
                        </TableCell>
                        <TableCell className="text-right tabular">{product.dealCount}</TableCell>
                        <TableCell className="text-right tabular">
                          {formatMoney(product.wonAmount)}
                        </TableCell>
                        {canWrite && (
                          <TableCell className="text-right">
                            <Select
                              value={product.status}
                              onValueChange={(value) =>
                                void changeStatus(product, value as ProductStatus)
                              }
                            >
                              <SelectTrigger
                                size="sm"
                                aria-label={`Статус «${product.name}»`}
                                className="ml-auto w-40"
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {PRODUCT_STATUS_ORDER.map((value) => (
                                  <SelectItem key={value} value={value}>
                                    {PRODUCT_STATUS_LABELS[value]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
              </TableBody>
            </Table>
          </TableWrapper>
        )}
      </Card>

      {showCreate && (
        <ProductDialog
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            void loadProducts();
          }}
        />
      )}
      {closing && (
        <CloseProductDialog
          product={closing}
          onClose={() => setClosing(null)}
          onClosed={() => {
            setClosing(null);
            void loadProducts();
          }}
        />
      )}
    </PageStack>
  );
}
