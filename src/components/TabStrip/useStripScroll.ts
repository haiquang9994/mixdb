import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { overflowState, scrollStep, type StripOverflow } from "./overflow";

/**
 * Một dải tab dài hơn chỗ nó có: cuộn ngang bằng chuột, và hai mũi tên nói phía nào còn tab bị
 * giấu.
 *
 * Ba việc nhỏ đi chung một hook vì chúng nhìn cùng một phần tử và cùng ba con số của nó — tách
 * thành ba thì mỗi cái lại tự đo lại một lần.
 *
 * Không có thanh cuộn nào để nhìn (xem `TabStrip.module.css`), nên hai mũi tên là thứ duy nhất nói
 * rằng còn tab ở ngoài khung. Chúng hiện và ẩn *cùng nhau*, theo `overflowing`, và chỉ mờ đi theo
 * `atStart`/`atEnd`: một mũi tên tự thêm vào rồi tự bớt đi làm khung hẹp lại rồi rộng ra, và một
 * dải tab đang ở ngay ranh giới sẽ nhấp nháy giữa hai trạng thái.
 */
export interface StripScroll extends StripOverflow {
  /** `-1` là về phía trái, `1` là về phía phải. */
  scrollBy: (direction: -1 | 1) => void;
}

const FITS: StripOverflow = { overflowing: false, atStart: true, atEnd: true };

export function useStripScroll(scroller: RefObject<HTMLDivElement | null>): StripScroll {
  const [state, setState] = useState<StripOverflow>(FITS);
  /* Cái trạng thái đang hiển thị, đọc được từ trong listener mà không phải dựng lại listener mỗi
     lần nó đổi. `setState` với một object mới mỗi lần đo là một vòng render vô tận, nên chỗ so
     sánh nằm ở đây. */
  const shown = useRef(state);

  const measure = useCallback(() => {
    const el = scroller.current;
    const next = el === null ? FITS : overflowState(el);
    const was = shown.current;
    if (
      next.overflowing === was.overflowing &&
      next.atStart === was.atStart &&
      next.atEnd === was.atEnd
    ) {
      return;
    }
    shown.current = next;
    setState(next);
  }, [scroller]);

  /* Sau mỗi lần render, vì mở thêm hay đóng bớt một tab đổi `scrollWidth` mà không đổi kích thước
     phần tử nào — `ResizeObserver` bên dưới không thấy gì. Rẻ như `useTabSlide` ngay cạnh: ba thuộc
     tính, và không `setState` khi ba con số ra cùng một kết quả. */
  useLayoutEffect(measure);

  useEffect(() => {
    const el = scroller.current;
    if (el === null) return;
    const stop = new AbortController();
    // Cuộn tới đâu thì mũi tên nào tắt đổi theo — kể cả lần cuộn do chính hai mũi tên gây ra.
    el.addEventListener("scroll", measure, { passive: true, signal: stop.signal });

    /* Bánh xe chuột chỉ có một trục, và trục ấy là trục dải tab không có. `passive: false` vì nó
       phải chặn cái mặc định: không chặn thì trang phía sau cuộn theo. Chuột cảm ứng gửi `deltaX`
       của riêng nó và được để yên — trình duyệt cuộn ngang hộ rồi. */
    el.addEventListener(
      "wheel",
      (e) => {
        if (e.deltaY === 0 || e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return;
        if (el.scrollWidth <= el.clientWidth) return;
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      },
      { passive: false, signal: stop.signal },
    );

    // Cửa sổ hẹp lại là số tab vừa khung ít đi, và một dải tab của tab không đứng trước thì rộng 0
    // cho tới lúc nó được nhìn tới.
    const resize = new ResizeObserver(measure);
    resize.observe(el);
    return () => {
      stop.abort();
      resize.disconnect();
    };
  }, [scroller, measure]);

  const scrollTo = useCallback(
    (direction: -1 | 1) => {
      const el = scroller.current;
      if (el === null) return;
      el.scrollBy({ left: direction * scrollStep(el.clientWidth), behavior: "smooth" });
    },
    [scroller],
  );

  return { ...state, scrollBy: scrollTo };
}

/**
 * Tab đang mở luôn nằm trong khung.
 *
 * `Ctrl+Tab` sang cái thứ mười, hay một tab mới mở ở cuối một dải đã đầy, thì cái được chọn nằm
 * ngoài chỗ nhìn thấy — và không còn thanh cuộn nào để nói nó ở đâu. Chỉ chạy khi tab đang mở *đổi*
 * chứ không phải sau mỗi lần render: nếu không thì người dùng cuộn sang xem một tab khác sẽ bị kéo
 * ngược về chỗ cũ ngay lập tức.
 *
 * `data-active` chứ không phải một prop: `TabStrip` nhận tab của mình dưới dạng `children` và không
 * biết cái nào đang mở — `Tab` thì biết, và nó đánh dấu lên chính nó.
 */
export function useActiveTabInView(scroller: RefObject<HTMLDivElement | null>): void {
  const last = useRef<Element | null>(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el === null) return;
    const active = el.querySelector("[data-active]");
    if (active === last.current) return;
    last.current = active;
    /* Một dải nằm trên tab không đứng trước được bày ở kích thước 0 và mọi thứ trong nó chồng lên
       nhau ở mép trái — cuộn theo cái đo được ở đó là cuộn về một chỗ vô nghĩa. Cùng lý do
       `useTabSlide` không đo một dải đang ẩn. */
    if (active === null || el.offsetParent === null) return;
    active.scrollIntoView({ block: "nearest", inline: "nearest" });
  });
}
