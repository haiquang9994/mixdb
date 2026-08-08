import Select from "../Select";
import Button from "../Button";
import styles from "./Pagination.module.css";

interface Props {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  pageSizeOptions: number[];
  loading?: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  className?: string;
}

function Pagination({
  page,
  pageCount,
  total,
  pageSize,
  pageSizeOptions,
  loading,
  onPageChange,
  onPageSizeChange,
  className,
}: Props) {
  return (
    <div className={`${styles.pagination}${className ? ` ${className}` : ""}`}>
      <Button
        size="small"
        className={styles.btn}
        aria-label="Previous page"
        disabled={page <= 0 || loading}
        onClick={() => onPageChange(Math.max(0, page - 1))}
      >
        ‹
      </Button>
      <span>
        Page {page + 1} of {pageCount} · {total} rows
      </span>
      <Button
        size="small"
        className={styles.btn}
        aria-label="Next page"
        disabled={page + 1 >= pageCount || loading}
        onClick={() => onPageChange(page + 1)}
      >
        ›
      </Button>
      <Select
        value={pageSize}
        onChange={onPageSizeChange}
        className={styles.pageSizeSelect}
        triggerClassName={styles.pageSizeSelectTrigger}
        optionAlign="right"
        options={pageSizeOptions.map((n) => ({ value: n, label: `${n} / page`, optionLabel: n }))}
      />
    </div>
  );
}

export default Pagination;
