FROM ghcr.io/engineer-man/piston:latest

# Install packages during build
RUN mkdir -p /piston/packages
RUN cd /piston/packages && \
    wget https://github.com/engineer-man/piston/releases/download/pkgs/gcc-10.2.0.tar.gz && \
    tar -xf gcc-10.2.0.tar.gz && \
    rm gcc-10.2.0.tar.gz

RUN cd /piston/packages && \
    wget https://github.com/engineer-man/piston/releases/download/pkgs/python-3.10.0.tar.gz && \
    tar -xf python-3.10.0.tar.gz && \
    rm python-3.10.0.tar.gz

RUN cd /piston/packages && \
    wget https://github.com/engineer-man/piston/releases/download/pkgs/node-18.15.0.tar.gz && \
    tar -xf node-18.15.0.tar.gz && \
    rm node-18.15.0.tar.gz

RUN cd /piston/packages && \
    wget https://github.com/engineer-man/piston/releases/download/pkgs/java-15.0.2.tar.gz && \
    tar -xf java-15.0.2.tar.gz && \
    rm java-15.0.2.tar.gz