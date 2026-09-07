import { loadModel, LLAMA_3_2_1B_INST_Q4_0, completion, unloadModel } from '@qvac/sdk';

try {
    const modelId = await loadModel({
        modelSrc: LLAMA_3_2_1B_INST_Q4_0,
        onProgress: (p) => {
            const mb = (n) => (n / 1e6).toFixed(1);
            const line = `▸ Descargando ${p.percentage.toFixed(0)}% (${mb(p.downloaded)}/${mb(p.total)} MB)`;
            process.stderr.write(process.stderr.isTTY ? `\r${line}` : `${line}\n`);
            if (p.percentage >= 100)
                process.stderr.write('\n');
        }
    });

    const history = [
        { role: 'user', content: 'Explica en una frase qué es la inferencia local' }
    ];

    const result = completion({ modelId, history, stream: true });
    for await (const token of result.tokenStream) {
        process.stdout.write(token);
    }
    process.stdout.write('\n');

    await unloadModel({ modelId });
}
catch (error) {
    console.error('✖', error);
    process.exit(1);
}
