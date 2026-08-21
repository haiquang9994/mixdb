use std::time::Duration;

use tokio::sync::mpsc::UnboundedReceiver;
use tokio::time::Instant;

/// Khung lớn nhất gửi qua IPC một lần.
pub const MAX_CHUNK: usize = 64 * 1024;

/// Đệm chờ lâu nhất bao lâu trước khi đẩy. Đủ ngắn để gõ phím không thấy trễ, đủ dài để `yes`
/// không sinh ra hàng nghìn khung một giây.
pub const FLUSH_AFTER: Duration = Duration::from_millis(5);

/// Gom byte đọc được thành khung rồi đưa cho `emit`: đủ `MAX_CHUNK` thì đẩy ngay, không thì đẩy
/// khi đệm đã nằm đó `FLUSH_AFTER`.
///
/// Hạn tính từ lúc đệm chuyển từ rỗng sang không rỗng. Đặt lại hạn mỗi lần nhận thêm byte là lỗi
/// kiểu Nagle: một dòng chảy đều, chậm, sẽ không bao giờ tới hạn.
///
/// Trả về khi `rx` đóng — tức khi đầu đọc đã xong — sau khi đẩy nốt phần còn lại. Đó là thứ khiến
/// `Exit` phát sau byte cuối cùng chứ không phải trước.
pub async fn coalesce<F>(mut rx: UnboundedReceiver<Vec<u8>>, mut emit: F)
where
    F: FnMut(Vec<u8>),
{
    let mut buffer: Vec<u8> = Vec::new();
    let mut deadline = Instant::now();

    loop {
        if buffer.is_empty() {
            match rx.recv().await {
                Some(chunk) => {
                    deadline = Instant::now() + FLUSH_AFTER;
                    buffer.extend_from_slice(&chunk);
                }
                None => break,
            }
        } else {
            tokio::select! {
                received = rx.recv() => match received {
                    Some(chunk) => buffer.extend_from_slice(&chunk),
                    None => break,
                },
                _ = tokio::time::sleep_until(deadline) => {
                    emit(std::mem::take(&mut buffer));
                    continue;
                }
            }
        }

        while buffer.len() >= MAX_CHUNK {
            let rest = buffer.split_off(MAX_CHUNK);
            emit(std::mem::replace(&mut buffer, rest));
        }
    }

    if !buffer.is_empty() {
        emit(buffer);
    }
}

#[cfg(test)]
mod tests {
    use super::{coalesce, FLUSH_AFTER, MAX_CHUNK};
    use std::sync::{Arc, Mutex};
    use std::time::Duration;
    use tokio::sync::mpsc;

    type Emitted = Arc<Mutex<Vec<Vec<u8>>>>;

    fn sink() -> (Emitted, impl FnMut(Vec<u8>)) {
        let seen: Emitted = Arc::new(Mutex::new(Vec::new()));
        let handle = seen.clone();
        (seen, move |chunk: Vec<u8>| handle.lock().unwrap().push(chunk))
    }

    #[tokio::test(start_paused = true)]
    async fn flushes_a_small_write_after_the_idle_window() {
        let (tx, rx) = mpsc::unbounded_channel();
        let (seen, emit) = sink();
        let task = tokio::spawn(coalesce(rx, emit));

        tx.send(b"hi".to_vec()).unwrap();
        tokio::time::sleep(FLUSH_AFTER * 2).await;
        assert_eq!(*seen.lock().unwrap(), vec![b"hi".to_vec()]);

        drop(tx);
        task.await.unwrap();
    }

    #[tokio::test(start_paused = true)]
    async fn flushes_a_full_chunk_without_waiting() {
        let (tx, rx) = mpsc::unbounded_channel();
        let (seen, emit) = sink();
        let task = tokio::spawn(coalesce(rx, emit));

        tx.send(vec![b'x'; MAX_CHUNK]).unwrap();
        // Nhường cho task chạy, nhưng không tiến đồng hồ: đủ 64KB là đẩy ngay.
        tokio::task::yield_now().await;
        assert_eq!(seen.lock().unwrap().len(), 1);
        assert_eq!(seen.lock().unwrap()[0].len(), MAX_CHUNK);

        drop(tx);
        task.await.unwrap();
    }

    /// Hạn 5ms tính từ byte đầu tiên, không từ byte gần nhất. Một dòng chảy đều mà đặt lại hạn
    /// mỗi lần nhận thì sẽ không bao giờ được đẩy.
    #[tokio::test(start_paused = true)]
    async fn keeps_the_deadline_from_the_first_byte() {
        let (tx, rx) = mpsc::unbounded_channel();
        let (seen, emit) = sink();
        let task = tokio::spawn(coalesce(rx, emit));

        for _ in 0..6 {
            tx.send(b"a".to_vec()).unwrap();
            tokio::time::sleep(Duration::from_millis(2)).await;
        }
        assert!(
            !seen.lock().unwrap().is_empty(),
            "12ms trôi qua mà chưa đẩy lần nào"
        );

        drop(tx);
        task.await.unwrap();
    }

    #[tokio::test(start_paused = true)]
    async fn never_emits_an_empty_chunk() {
        let (tx, rx) = mpsc::unbounded_channel::<Vec<u8>>();
        let (seen, emit) = sink();
        let task = tokio::spawn(coalesce(rx, emit));

        tokio::time::sleep(FLUSH_AFTER * 10).await;
        drop(tx);
        task.await.unwrap();

        assert!(seen.lock().unwrap().is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn flushes_what_is_left_when_the_source_ends() {
        let (tx, rx) = mpsc::unbounded_channel();
        let (seen, emit) = sink();
        let task = tokio::spawn(coalesce(rx, emit));

        tx.send(b"bye".to_vec()).unwrap();
        drop(tx);
        task.await.unwrap();

        assert_eq!(*seen.lock().unwrap(), vec![b"bye".to_vec()]);
    }
}
