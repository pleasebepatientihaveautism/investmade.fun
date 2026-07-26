fn main() {
    substreams_ethereum::Abigen::new("PoolManager", "abi/pool_manager.json")
        .expect("load PoolManager ABI")
        .generate()
        .expect("generate PoolManager bindings")
        .write_to_file("src/abi/pool_manager.rs")
        .expect("write PoolManager bindings");

    prost_build::compile_protos(&["proto/uniswap_v4.proto"], &["proto/"]).unwrap();
}
