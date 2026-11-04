use std::sync::atomic::{AtomicU32, AtomicU64, AtomicUsize, Ordering};

struct Slot {
    sample: AtomicU32,
    frame: AtomicU64,
}
/// One producer and one consumer. All storage is allocated before input starts.
pub(crate) struct SampleQueue {
    slots: Box<[Slot]>,
    read: AtomicUsize,
    write: AtomicUsize,
}
impl SampleQueue {
    pub fn new(capacity: usize) -> Self {
        assert!(capacity > 0);
        Self {
            slots: (0..capacity)
                .map(|_| Slot {
                    sample: AtomicU32::new(0),
                    frame: AtomicU64::new(0),
                })
                .collect(),
            read: AtomicUsize::new(0),
            write: AtomicUsize::new(0),
        }
    }
    pub fn push(&self, sample: f32, frame: u64) -> bool {
        let write = self.write.load(Ordering::Relaxed);
        if write.wrapping_sub(self.read.load(Ordering::Acquire)) >= self.slots.len() {
            return false;
        }
        let slot = &self.slots[write % self.slots.len()];
        slot.sample.store(sample.to_bits(), Ordering::Relaxed);
        slot.frame.store(frame, Ordering::Relaxed);
        self.write.store(write.wrapping_add(1), Ordering::Release);
        true
    }
    pub fn pop(&self) -> Option<(f32, u64)> {
        let read = self.read.load(Ordering::Relaxed);
        if read == self.write.load(Ordering::Acquire) {
            return None;
        }
        let slot = &self.slots[read % self.slots.len()];
        let result = (
            f32::from_bits(slot.sample.load(Ordering::Relaxed)),
            slot.frame.load(Ordering::Relaxed),
        );
        self.read.store(read.wrapping_add(1), Ordering::Release);
        Some(result)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    #[test]
    fn bounded_and_ordered_across_threads() {
        let queue = Arc::new(SampleQueue::new(31));
        for n in 0..31 {
            assert!(queue.push(n as f32, n));
        }
        assert!(!queue.push(99.0, 99));
        for n in 0..31 {
            assert_eq!(queue.pop(), Some((n as f32, n)));
        }
        assert_eq!(queue.pop(), None);
        let producer = queue.clone();
        let thread = std::thread::spawn(move || {
            for n in 0..100_000 {
                while !producer.push(n as f32, n) {
                    std::thread::yield_now();
                }
            }
        });
        for n in 0..100_000 {
            loop {
                if let Some(sample) = queue.pop() {
                    assert_eq!(sample, (n as f32, n));
                    break;
                }
                std::thread::yield_now();
            }
        }
        thread.join().unwrap();
    }
}
